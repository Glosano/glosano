"""Daily reading counters and deduplication ledger (ADR-0010)."""

import uuid
from datetime import date as date_value
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from glosano.core.db import Base


class StatisticsTracking(Base):
    __tablename__ = "statistics_tracking"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (CheckConstraint("id = 1", name="ck_statistics_tracking_singleton"),)


class DailyUserStats(Base):
    __tablename__ = "daily_user_stats"
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[date_value] = mapped_column(Date, primary_key=True)
    tokens_read: Mapped[int] = mapped_column(Integer, server_default="0")
    __table_args__ = (CheckConstraint("tokens_read >= 0", name="ck_daily_user_stats_read"),)


class DailyUserLanguageStats(Base):
    __tablename__ = "daily_user_language_stats"
    user_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    date: Mapped[date_value] = mapped_column(Date, primary_key=True)
    language_code: Mapped[str] = mapped_column(String(8), primary_key=True)
    tokens_read: Mapped[int] = mapped_column(Integer, server_default="0")
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "date"],
            ["daily_user_stats.user_id", "daily_user_stats.date"],
            ondelete="CASCADE",
        ),
        CheckConstraint("tokens_read >= 0", name="ck_daily_user_language_stats_read"),
    )


class DailyReadOccurrence(Base):
    __tablename__ = "daily_read_occurrences"
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[date_value] = mapped_column(Date, primary_key=True)
    # Keep the identity after lesson deletion; totals remain historical activity.
    lesson_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
