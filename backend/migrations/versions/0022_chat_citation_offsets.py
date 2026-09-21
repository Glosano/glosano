"""Preserve exact quote positions in immutable paragraph snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "0022_chat_citation_offsets"
down_revision = "0021_chat_generation_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_citations", sa.Column("context_start_offset", sa.Integer(), nullable=True))
    op.add_column("chat_citations", sa.Column("context_end_offset", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_citations", "context_end_offset")
    op.drop_column("chat_citations", "context_start_offset")
