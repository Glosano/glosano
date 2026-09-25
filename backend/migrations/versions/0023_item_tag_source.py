"""Remember whether a personal tag was entered manually or suggested by AI."""

import sqlalchemy as sa
from alembic import op

revision = "0023_item_tag_source"
down_revision = "0022_chat_citation_offsets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "item_tags", sa.Column("source_type", sa.String(16), nullable=False, server_default="user")
    )
    op.create_check_constraint(
        "ck_item_tags_source_type", "item_tags", "source_type IN ('user', 'ai')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_item_tags_source_type", "item_tags", type_="check")
    op.drop_column("item_tags", "source_type")
