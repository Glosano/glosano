# ruff: noqa: RUF002
"""SRS review tables (FLQ-7): current state + append-only history."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from glosano.core.db import Base


class ReviewItem(Base):
    """Текущее SRS-состояние одного learning item (domain model §10.2).

    (item_kind, item_id) — полиморфная ссылка на token_items/phrase_items без FK,
    как в PersonalTranslation. language_code денормализован: язык item неизменяем,
    а очередь фильтруется по нему без join.
    """

    __tablename__ = "review_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    item_kind: Mapped[str] = mapped_column(String(16))
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    language_code: Mapped[str] = mapped_column(String(8))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    algorithm_name: Mapped[str] = mapped_column(String(16), default="sm2")
    algorithm_state_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint("item_kind IN ('token', 'phrase')", name="ck_review_items_kind"),
        Index(
            "uq_review_items_active",
            "user_id",
            "item_kind",
            "item_id",
            unique=True,
            postgresql_where=text("is_active"),
        ),
        Index("ix_review_items_queue", "user_id", "language_code", "is_active", "due_at"),
    )


class ReviewEvent(Base):
    """Append-only история ответов (domain model §10.3). Нет UPDATE/DELETE путей."""

    __tablename__ = "review_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    review_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("review_items.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    answer_value: Mapped[str] = mapped_column(String(8))
    quality: Mapped[int | None] = mapped_column(SmallInteger)
    previous_confidence: Mapped[int | None] = mapped_column(SmallInteger)
    new_confidence: Mapped[int | None] = mapped_column(SmallInteger)
    previous_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    new_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("answer_value IN ('correct', 'wrong')", name="ck_review_events_answer"),
        CheckConstraint(
            "quality IS NULL OR (quality >= 0 AND quality <= 5)",
            name="ck_review_events_quality_range",
        ),
        Index("ix_review_events_user_time", "user_id", "reviewed_at"),
    )
