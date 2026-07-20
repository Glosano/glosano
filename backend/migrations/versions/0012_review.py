# ruff: noqa: S608
"""review_items + review_events + backfill active items for tracked vocab (FLQ-7)

Revision ID: 0012_review
Revises: 0011_phrase_text_check
Create Date: 2026-07-20 00:00:00.000000

Backfill: каждый tracked token/phrase item получает активный review_item
(due сразу, свежий SM-2 state). После этого инвариант «tracked ⇔ активный
review_item» поддерживает lifecycle-синк в modules/review/service.py.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0012_review"
down_revision: str | Sequence[str] | None = "0011_phrase_text_check"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INITIAL_STATE = '{"ease_factor": 2.5, "interval_days": 0.0, "repetitions": 0}'

BACKFILL_SQL_TOKENS = f"""
INSERT INTO review_items
    (id, user_id, item_kind, item_id, language_code, is_active,
     algorithm_name, algorithm_state_json, due_at, created_at, updated_at)
SELECT gen_random_uuid(), user_id, 'token', id, language_code, TRUE,
       'sm2', '{_INITIAL_STATE}'::jsonb, now(), now(), now()
FROM token_items WHERE status = 'tracked'
"""

BACKFILL_SQL_PHRASES = f"""
INSERT INTO review_items
    (id, user_id, item_kind, item_id, language_code, is_active,
     algorithm_name, algorithm_state_json, due_at, created_at, updated_at)
SELECT gen_random_uuid(), user_id, 'phrase', id, language_code, TRUE,
       'sm2', '{_INITIAL_STATE}'::jsonb, now(), now(), now()
FROM phrase_items WHERE status = 'tracked'
"""


def upgrade() -> None:
    op.create_table(
        "review_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("item_kind", sa.String(length=16), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("language_code", sa.String(length=8), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("algorithm_name", sa.String(length=16), nullable=False),
        sa.Column("algorithm_state_json", JSONB(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("item_kind IN ('token', 'phrase')", name="ck_review_items_kind"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_review_items_active",
        "review_items",
        ["user_id", "item_kind", "item_id"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )
    op.create_index(
        "ix_review_items_queue",
        "review_items",
        ["user_id", "language_code", "is_active", "due_at"],
    )

    op.create_table(
        "review_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("review_item_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("answer_value", sa.String(length=8), nullable=False),
        sa.Column("previous_confidence", sa.SmallInteger(), nullable=True),
        sa.Column("new_confidence", sa.SmallInteger(), nullable=True),
        sa.Column("previous_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("new_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "reviewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("answer_value IN ('correct', 'wrong')", name="ck_review_events_answer"),
        sa.ForeignKeyConstraint(["review_item_id"], ["review_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_review_events_user_time", "review_events", ["user_id", "reviewed_at"])

    op.execute(BACKFILL_SQL_TOKENS)
    op.execute(BACKFILL_SQL_PHRASES)


def downgrade() -> None:
    op.drop_index("ix_review_events_user_time", table_name="review_events")
    op.drop_table("review_events")
    op.drop_index("ix_review_items_queue", table_name="review_items")
    op.drop_index("uq_review_items_active", table_name="review_items")
    op.drop_table("review_items")
