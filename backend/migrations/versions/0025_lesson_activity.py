"""Track the last meaningful activity per (user, lesson) for the library (FLQ-36)."""

import sqlalchemy as sa
from alembic import op

revision = "0025_lesson_activity"
down_revision = "0024_numeric_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reader_positions",
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True),
    )
    # A non-null position alone proves nothing: the reader saves the end of the
    # first page on the very first open. Only completion, a page turn
    # (bulk_actions) or a word taken from this lesson count as past work.
    op.execute("""
        UPDATE reader_positions rp SET last_activity_at = rp.last_opened_at
        WHERE rp.completed_at IS NOT NULL
           OR EXISTS (SELECT 1 FROM bulk_actions b
                      WHERE b.user_id = rp.user_id AND b.lesson_id = rp.lesson_id)
           OR EXISTS (SELECT 1 FROM token_items t
                      WHERE t.user_id = rp.user_id AND t.created_from_lesson_id = rp.lesson_id)
           OR EXISTS (SELECT 1 FROM phrase_items p
                      WHERE p.user_id = rp.user_id AND p.created_from_lesson_id = rp.lesson_id)
    """)
    op.create_index(
        "ix_reader_positions_user_activity",
        "reader_positions",
        ["user_id", "last_activity_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_reader_positions_user_activity", table_name="reader_positions")
    op.drop_column("reader_positions", "last_activity_at")
