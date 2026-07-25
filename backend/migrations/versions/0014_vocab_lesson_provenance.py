"""vocab lesson provenance: created_from_lesson_id / created_from_segment_id

Revision ID: 0014_vocab_lesson_provenance
Revises: 0013_review_quality
Create Date: 2026-07-25 00:00:00.000000

Скоуп повторения урока = слова и фразы, добавленные в этом уроке.
created_from_occurrence_id удаляется: колонка не заполнялась ни одним
write-путём (0 непустых значений), её роль занимает created_from_segment_id.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014_vocab_lesson_provenance"
down_revision: str | Sequence[str] | None = "0013_review_quality"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("token_items", "phrase_items")


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column("created_from_lesson_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.add_column(
            table,
            sa.Column("created_from_segment_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            f"fk_{table}_created_from_lesson",
            table,
            "lessons",
            ["created_from_lesson_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(
            f"ix_{table}_user_lesson",
            table,
            ["user_id", "created_from_lesson_id"],
            postgresql_where=sa.text("created_from_lesson_id IS NOT NULL"),
        )
    op.drop_column("token_items", "created_from_occurrence_id")


def downgrade() -> None:
    op.add_column(
        "token_items",
        sa.Column("created_from_occurrence_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    for table in _TABLES:
        op.drop_index(f"ix_{table}_user_lesson", table_name=table)
        op.drop_constraint(f"fk_{table}_created_from_lesson", table, type_="foreignkey")
        op.drop_column(table, "created_from_segment_id")
        op.drop_column(table, "created_from_lesson_id")
