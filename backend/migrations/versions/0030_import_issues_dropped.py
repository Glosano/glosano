"""Count of import report issues past the listed cap (FLQ-14, ADR-0033)."""

import sqlalchemy as sa
from alembic import op

revision = "0030_import_issues_dropped"
down_revision = "0029_vocabulary_import"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vocabulary_import_jobs",
        sa.Column("issues_dropped", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("vocabulary_import_jobs", "issues_dropped")
