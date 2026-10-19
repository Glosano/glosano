"""Vocabulary import jobs and the import_source marker (FLQ-14, ADR-0033)."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0029_vocabulary_import"
down_revision = "0028_native_language"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vocabulary_import_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("language_code", sa.String(length=8), nullable=False),
        sa.Column("source", sa.String(length=8), nullable=False),
        sa.Column("conflict_mode", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="running"),
        sa.Column("total", sa.Integer(), nullable=True),
        sa.Column("processed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_phrases", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("known_words", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "issues_json",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("meta_json", postgresql.JSONB(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("source IN ('csv', 'lingq')", name="ck_vocabulary_import_jobs_source"),
        sa.CheckConstraint(
            "conflict_mode IN ('keep', 'update')", name="ck_vocabulary_import_jobs_conflict_mode"
        ),
        sa.CheckConstraint(
            "status IN ('running', 'done', 'failed', 'interrupted')",
            name="ck_vocabulary_import_jobs_status",
        ),
    )
    op.create_index(
        "uq_vocabulary_import_jobs_running",
        "vocabulary_import_jobs",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'running'"),
    )
    for table in ("token_items", "phrase_items"):
        op.add_column(table, sa.Column("import_source", sa.String(length=16), nullable=True))
        op.create_check_constraint(
            f"ck_{table}_import_source", table, "import_source IS NULL OR import_source = 'lingq'"
        )


def downgrade() -> None:
    for table in ("phrase_items", "token_items"):
        op.drop_constraint(f"ck_{table}_import_source", table, type_="check")
        op.drop_column(table, "import_source")
    op.drop_index("uq_vocabulary_import_jobs_running", table_name="vocabulary_import_jobs")
    op.drop_table("vocabulary_import_jobs")
