"""Personal lesson tags (FLQ-39, ADR-0026)."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0026_lesson_tags"
down_revision = "0025_lesson_activity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lesson_tags",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "lesson_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("lessons.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tag", sa.String(40), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("user_id", "lesson_id", "tag"),
    )
    op.create_index("ix_lesson_tags_user_tag", "lesson_tags", ["user_id", "tag"])
    # Lesson deletion cascades by lesson_id; without this index it scans the table.
    op.create_index("ix_lesson_tags_lesson", "lesson_tags", ["lesson_id"])


def downgrade() -> None:
    op.drop_index("ix_lesson_tags_lesson", table_name="lesson_tags")
    op.drop_index("ix_lesson_tags_user_tag", table_name="lesson_tags")
    op.drop_table("lesson_tags")
