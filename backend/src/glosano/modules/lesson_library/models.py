"""Lesson library models: lessons plus the processing-pipeline facts.

Lesson *facts* (sources, segments, token occurrences) are stored separately
from per-user knowledge. Occurrences deliberately have NO foreign key to
token_items; the link is computed later via
(user_id, lesson.language_code, normalized_text). See domain model §2.4, §6.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from glosano.core.db import Base

LessonStatus = Literal["draft", "processing", "ready", "failed", "archived"]
LessonVisibility = Literal["private", "shared"]
SegmentType = Literal["sentence", "paragraph"]
SourceType = Literal["manual", "file", "url", "ocr", "youtube"]
JobStatus = Literal["pending", "running", "done", "failed"]


class Lesson(Base):
    __tablename__ = "lessons"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    language_code: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    segment_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_source_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    visibility: Mapped[LessonVisibility] = mapped_column(
        String(16), nullable=False, default="private"
    )
    status: Mapped[LessonStatus] = mapped_column(String(16), nullable=False, default="ready")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=func.now(),
    )


class LessonSource(Base):
    __tablename__ = "lesson_sources"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lessons.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_type: Mapped[SourceType] = mapped_column(String(16), nullable=False, default="manual")
    source_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    author: Mapped[str | None] = mapped_column(String(200), nullable=True)
    license: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class LessonSegment(Base):
    __tablename__ = "lesson_segments"
    __table_args__ = (UniqueConstraint("lesson_id", "ordinal", name="uq_segment_lesson_ordinal"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lessons.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    media_start_ms: Mapped[int | None] = mapped_column(Integer)
    media_end_ms: Mapped[int | None] = mapped_column(Integer)
    cue_start: Mapped[int | None] = mapped_column(Integer)
    cue_end: Mapped[int | None] = mapped_column(Integer)
    cue_intervals: Mapped[list[dict[str, int]] | None] = mapped_column(JSONB)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    segment_type: Mapped[SegmentType] = mapped_column(
        String(16), nullable=False, default="sentence"
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    start_char_offset: Mapped[int] = mapped_column(Integer, nullable=False)
    end_char_offset: Mapped[int] = mapped_column(Integer, nullable=False)


class LessonTokenOccurrence(Base):
    __tablename__ = "lesson_token_occurrences"
    __table_args__ = (
        UniqueConstraint("lesson_id", "ordinal_in_lesson", name="uq_occurrence_lesson_ordinal"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lessons.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    segment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lesson_segments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    ordinal_in_lesson: Mapped[int] = mapped_column(Integer, nullable=False)
    ordinal_in_segment: Mapped[int] = mapped_column(Integer, nullable=False)
    surface_text: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_text: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    start_char_offset: Mapped[int] = mapped_column(Integer, nullable=False)
    end_char_offset: Mapped[int] = mapped_column(Integer, nullable=False)
    is_word_like: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class LessonImportJob(Base):
    __tablename__ = "lesson_import_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lessons.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    requested_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    request_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("requested_by_user_id", "request_id", name="uq_import_user_request"),
    )
    job_type: Mapped[str] = mapped_column(String(32), nullable=False, default="import_text")
    status: Mapped[JobStatus] = mapped_column(String(16), nullable=False, default="pending")
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class LessonMediaSource(Base):
    __tablename__ = "lesson_media_sources"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lesson_sources.id", ondelete="CASCADE"), unique=True
    )
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lessons.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(16), default="youtube")
    video_id: Mapped[str] = mapped_column(String(11))
    canonical_url: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(String(200))
    author: Mapped[str | None] = mapped_column(String(200))
    language_code: Mapped[str] = mapped_column(String(32))
    is_generated: Mapped[bool] = mapped_column(Boolean)
    cue_snapshot: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    preparation_version: Mapped[int] = mapped_column(Integer, default=1)
    user_edited: Mapped[bool] = mapped_column(Boolean, default=False)
