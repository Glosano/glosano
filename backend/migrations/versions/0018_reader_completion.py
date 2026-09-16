"""Per-user lesson completion (ADR-0014)."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0018_reader_completion"
down_revision = "0017_ui_language_translation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reader_positions", sa.Column("completed_at", sa.DateTime(timezone=True)))
    op.add_column(
        "reader_positions", sa.Column("completion_action_id", postgresql.UUID(as_uuid=True))
    )


def downgrade() -> None:
    op.drop_column("reader_positions", "completion_action_id")
    op.drop_column("reader_positions", "completed_at")
