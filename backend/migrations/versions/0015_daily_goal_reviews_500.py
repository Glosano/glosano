"""daily_goal_reviews: дневной лимит повторений 20 -> 500

Revision ID: 0015_daily_goal_reviews_500
Revises: 0014_vocab_lesson_provenance
Create Date: 2026-07-25 00:00:00.000000

Экрана настроек пока нет (FLQ-9), поэтому во всех существующих строках лимит
равен прежнему дефолту 20 — их и переводим на 500. Строки, где значение
выставлено вручную, не трогаем.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_daily_goal_reviews_500"
down_revision: str | Sequence[str] | None = "0014_vocab_lesson_provenance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text("UPDATE user_settings SET daily_goal_reviews = 500 WHERE daily_goal_reviews = 20")
    )


def downgrade() -> None:
    op.execute(
        sa.text("UPDATE user_settings SET daily_goal_reviews = 20 WHERE daily_goal_reviews = 500")
    )
