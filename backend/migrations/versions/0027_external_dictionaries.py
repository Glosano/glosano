"""Custom external dictionaries and per-pair layouts (FLQ-46)."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0027_external_dictionaries"
down_revision = "0026_lesson_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_external_dictionaries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("url_template", sa.String(500), nullable=False),
        sa.Column("source_language_code", sa.String(8), nullable=True),
        sa.Column("target_language_code", sa.String(8), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "(source_language_code IS NULL) = (target_language_code IS NULL)",
            name="ck_user_external_dictionaries_pair",
        ),
    )
    op.create_index("ix_user_external_dictionaries_user", "user_external_dictionaries", ["user_id"])
    op.create_table(
        "user_dictionary_layouts",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_language_code", sa.String(8), nullable=False),
        sa.Column("target_language_code", sa.String(8), nullable=False),
        sa.Column(
            "visible",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "hidden",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("user_id", "source_language_code", "target_language_code"),
    )


def downgrade() -> None:
    op.drop_table("user_dictionary_layouts")
    op.drop_index("ix_user_external_dictionaries_user", table_name="user_external_dictionaries")
    op.drop_table("user_external_dictionaries")
