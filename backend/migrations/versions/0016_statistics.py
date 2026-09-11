"""Daily reading accounting (ADR-0010)."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016_statistics"
down_revision: str | Sequence[str] | None = "0015_daily_goal_reviews_500"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "statistics_tracking",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("id = 1", name="ck_statistics_tracking_singleton"),
    )
    op.execute("INSERT INTO statistics_tracking (id) VALUES (1)")
    op.create_table(
        "daily_user_stats",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("date", sa.Date(), primary_key=True),
        sa.Column("tokens_read", sa.Integer(), server_default="0", nullable=False),
        sa.CheckConstraint("tokens_read >= 0", name="ck_daily_user_stats_read"),
    )
    op.create_table(
        "daily_user_language_stats",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("date", sa.Date(), primary_key=True),
        sa.Column("language_code", sa.String(8), primary_key=True),
        sa.Column("tokens_read", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id", "date"],
            ["daily_user_stats.user_id", "daily_user_stats.date"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("tokens_read >= 0", name="ck_daily_user_language_stats_read"),
    )
    op.create_table(
        "daily_read_occurrences",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("date", sa.Date(), primary_key=True),
        sa.Column("lesson_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ordinal", sa.Integer(), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("daily_read_occurrences")
    op.drop_table("daily_user_language_stats")
    op.drop_table("daily_user_stats")
    op.drop_table("statistics_tracking")
