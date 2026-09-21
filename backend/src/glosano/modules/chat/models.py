"""Durable user content; direct owner FKs make profile deletion authoritative."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from glosano.core.db import Base


class Owned:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class Conversation(Owned, Base):
    __tablename__ = "chat_conversations"
    __table_args__ = (UniqueConstraint("id", "user_id"),)
    title: Mapped[str] = mapped_column(String(120))
    learning_language_code: Mapped[str] = mapped_column(String(8))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


def conversation_fk() -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        ["conversation_id", "user_id"],
        ["chat_conversations.id", "chat_conversations.user_id"],
        ondelete="CASCADE",
    )


def child_fk(column: str, table: str) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        [column, "conversation_id", "user_id"],
        [f"{table}.id", f"{table}.conversation_id", f"{table}.user_id"],
        ondelete="CASCADE",
    )


class Draft(Owned, Base):
    __tablename__ = "chat_drafts"
    __table_args__ = (
        conversation_fk(),
        UniqueConstraint("user_id", "conversation_id"),
        Index(
            "uq_chat_new_draft",
            "user_id",
            unique=True,
            postgresql_where=text("conversation_id IS NULL"),
        ),
        CheckConstraint("revision >= 0"),
    )
    conversation_id: Mapped[uuid.UUID | None]
    revision: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text, default="")
    citation_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    exercise_id: Mapped[uuid.UUID | None]
    attempt_id: Mapped[uuid.UUID | None]
    answers: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict)


class Message(Owned, Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        conversation_fk(),
        UniqueConstraint("id", "conversation_id", "user_id"),
        CheckConstraint("role IN ('user', 'assistant')"),
        CheckConstraint("state IN ('complete', 'pending', 'error', 'cancelled')"),
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(index=True)
    role: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text, default="")
    state: Mapped[str] = mapped_column(String(16), default="complete")
    ui_language: Mapped[str] = mapped_column(String(8))
    exercise_id: Mapped[uuid.UUID | None]
    attempt_id: Mapped[uuid.UUID | None]


class Citation(Owned, Base):
    __tablename__ = "chat_citations"
    __table_args__ = (conversation_fk(), child_fk("message_id", "chat_messages"))
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    message_id: Mapped[uuid.UUID | None]
    lesson_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("lessons.id", ondelete="SET NULL")
    )
    source_version: Mapped[int]
    title: Mapped[str] = mapped_column(String(200))
    language_code: Mapped[str] = mapped_column(String(8))
    selected_text: Mapped[str] = mapped_column(Text)
    context_text: Mapped[str] = mapped_column(Text)
    from_ordinal: Mapped[int]
    to_ordinal: Mapped[int]
    context_start_offset: Mapped[int | None]
    context_end_offset: Mapped[int | None]
    start_offset: Mapped[int]
    end_offset: Mapped[int]
    media_start_ms: Mapped[int | None]
    media_end_ms: Mapped[int | None]


class Exercise(Owned, Base):
    __tablename__ = "chat_exercises"
    __table_args__ = (
        conversation_fk(),
        child_fk("message_id", "chat_messages"),
        UniqueConstraint("id", "conversation_id", "user_id"),
        CheckConstraint("kind IN ('single_choice', 'gap', 'free_response')"),
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(index=True)
    message_id: Mapped[uuid.UUID]
    kind: Mapped[str] = mapped_column(String(24))
    prompt: Mapped[str] = mapped_column(Text)
    public_data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    grading_data: Mapped[dict[str, Any]] = mapped_column(JSONB)


class Attempt(Owned, Base):
    __tablename__ = "chat_attempts"
    __table_args__ = (
        conversation_fk(),
        child_fk("exercise_id", "chat_exercises"),
        UniqueConstraint("user_id", "operation_id"),
        UniqueConstraint("id", "conversation_id", "user_id"),
        CheckConstraint("status IN ('complete', 'pending', 'failed')"),
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(index=True)
    exercise_id: Mapped[uuid.UUID]
    operation_id: Mapped[uuid.UUID]
    answer: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16))
    correct: Mapped[bool | None] = mapped_column(Boolean)
    feedback: Mapped[str | None] = mapped_column(Text)


class Generation(Owned, Base):
    __tablename__ = "chat_generations"
    __table_args__ = (
        conversation_fk(),
        child_fk("message_id", "chat_messages"),
        child_fk("request_message_id", "chat_messages"),
        child_fk("attempt_id", "chat_attempts"),
        UniqueConstraint("user_id", "operation_id"),
        Index(
            "uq_chat_active_generation",
            "conversation_id",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
        CheckConstraint("kind IN ('reply', 'exercise', 'evaluation')"),
        CheckConstraint(
            "status IN ('queued', 'running', 'complete', 'failed', 'cancelled', 'interrupted')"
        ),
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(index=True)
    operation_id: Mapped[uuid.UUID]
    kind: Mapped[str] = mapped_column(String(16))
    message_id: Mapped[uuid.UUID]
    request_message_id: Mapped[uuid.UUID | None]
    retry_of_id: Mapped[uuid.UUID | None]
    attempt_id: Mapped[uuid.UUID | None]
    status: Mapped[str] = mapped_column(String(16), default="queued")
    partial_text: Mapped[str] = mapped_column(Text, default="")
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(64))
    context_truncated: Mapped[bool] = mapped_column(Boolean, default=False)
    # Bounded, validated command metadata, never arbitrary provider state.
    exercise_kind: Mapped[str | None] = mapped_column(String(24))
    ui_language: Mapped[str] = mapped_column(String(8))
