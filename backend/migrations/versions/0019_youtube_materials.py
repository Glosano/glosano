"""Versioned YouTube media, leased imports and idempotent bulk transitions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0019_youtube_materials"
down_revision = "0018_reader_completion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ("media_start_ms", "media_end_ms", "cue_start", "cue_end"):
        op.add_column("lesson_segments", sa.Column(name, sa.Integer()))
    op.add_column("lesson_segments", sa.Column("cue_intervals", postgresql.JSONB()))
    op.add_column("lesson_import_jobs", sa.Column("request_id", postgresql.UUID(as_uuid=True)))
    op.add_column("lesson_import_jobs", sa.Column("lease_expires_at", sa.DateTime(timezone=True)))
    op.create_unique_constraint(
        "uq_import_user_request", "lesson_import_jobs", ["requested_by_user_id", "request_id"]
    )
    op.add_column("bulk_actions", sa.Column("request_id", postgresql.UUID(as_uuid=True)))
    op.add_column("bulk_actions", sa.Column("source_version", sa.Integer()))
    op.create_unique_constraint("uq_bulk_user_request", "bulk_actions", ["user_id", "request_id"])
    op.create_table(
        "lesson_media_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "source_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("lesson_sources.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "lesson_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("lessons.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("video_id", sa.String(11), nullable=False),
        sa.Column("canonical_url", sa.Text(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("author", sa.String(200)),
        sa.Column("language_code", sa.String(32), nullable=False),
        sa.Column("is_generated", sa.Boolean(), nullable=False),
        sa.Column("cue_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("preparation_version", sa.Integer(), nullable=False),
        sa.Column("user_edited", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_lesson_media_sources_lesson_id", "lesson_media_sources", ["lesson_id"])


def downgrade() -> None:
    op.drop_table("lesson_media_sources")
    op.drop_constraint("uq_bulk_user_request", "bulk_actions", type_="unique")
    op.drop_column("bulk_actions", "source_version")
    op.drop_column("bulk_actions", "request_id")
    op.drop_constraint("uq_import_user_request", "lesson_import_jobs", type_="unique")
    op.drop_column("lesson_import_jobs", "lease_expires_at")
    op.drop_column("lesson_import_jobs", "request_id")
    for name in ("media_start_ms", "media_end_ms", "cue_start", "cue_end", "cue_intervals"):
        op.drop_column("lesson_segments", name)
