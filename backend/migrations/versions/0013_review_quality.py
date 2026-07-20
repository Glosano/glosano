# ruff: noqa: RUF002
"""review_events.quality — самооценка 0..5 (FLQ-20)

Revision ID: 0013_review_quality
Revises: 0012_review
Create Date: 2026-07-20 00:00:00.000000

Новые события пишут quality и производный answer_value ('correct' при q>=3).
Старые строки остаются с quality NULL — аналитика по answer_value не ломается.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_review_quality"
down_revision: str | Sequence[str] | None = "0012_review"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("review_events", sa.Column("quality", sa.SmallInteger(), nullable=True))
    op.create_check_constraint(
        "ck_review_events_quality_range",
        "review_events",
        "quality IS NULL OR (quality >= 0 AND quality <= 5)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_review_events_quality_range", "review_events", type_="check")
    op.drop_column("review_events", "quality")
