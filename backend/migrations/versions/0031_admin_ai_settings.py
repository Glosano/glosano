"""Durable instance AI settings and provider-aware translation cache (ADR-0036)."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0031_admin_ai_settings"
down_revision = "0030_import_issues_dropped"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "instance_ai_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("base_url", sa.String(2048), nullable=False),
        sa.Column("model", sa.String(255), nullable=False),
        sa.Column("key_ciphertext", sa.Text(), nullable=True),
        sa.Column(
            "updated_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("id = 1", name="ck_ai_settings_singleton"),
    )
    op.add_column(
        "lesson_segment_translations",
        sa.Column("provider_revision", sa.String(80), nullable=False, server_default="legacy"),
    )
    op.drop_constraint("uq_segment_translation_user_lang", "lesson_segment_translations")
    op.create_unique_constraint(
        "uq_segment_translation_user_lang",
        "lesson_segment_translations",
        ["user_id", "segment_id", "target_language_code", "provider_revision"],
    )


def downgrade() -> None:
    # Never discard provider-specific translations or silently reactivate legacy env settings.
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM instance_ai_settings)")):
        raise RuntimeError("Restore the pre-upgrade backup to downgrade configured AI settings")
    if connection.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM lesson_segment_translations "
            "WHERE provider_revision <> 'legacy')"
        )
    ):
        raise RuntimeError(
            "Restore the pre-upgrade backup to downgrade provider-aware translations"
        )
    op.drop_constraint("uq_segment_translation_user_lang", "lesson_segment_translations")
    op.create_unique_constraint(
        "uq_segment_translation_user_lang",
        "lesson_segment_translations",
        ["user_id", "segment_id", "target_language_code"],
    )
    op.drop_column("lesson_segment_translations", "provider_revision")
    op.drop_table("instance_ai_settings")
