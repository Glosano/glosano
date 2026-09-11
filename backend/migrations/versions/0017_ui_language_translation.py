"""UI-derived translation preference and personal sentence caches (ADR-0011)."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0017_ui_language_translation"
down_revision = "0016_statistics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE user_settings AS settings
        SET preferred_translation_language_code = profile.ui_language_code
        FROM user_profiles AS profile
        WHERE settings.user_id = profile.user_id
    """)
    op.add_column(
        "lesson_segment_translations",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_segment_translation_user",
        "lesson_segment_translations",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_constraint("uq_segment_translation_lang", "lesson_segment_translations", type_="unique")
    op.create_unique_constraint(
        "uq_segment_translation_user_lang",
        "lesson_segment_translations",
        ["user_id", "segment_id", "target_language_code"],
    )


def downgrade() -> None:
    # Downgrading removes attribution and would expose personal AI results to others.
    # Refuse without touching data; an operator must explicitly archive them first.
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM lesson_segment_translations WHERE user_id IS NOT NULL)"
        )
    ):
        raise RuntimeError(
            "Archive personal sentence translations before downgrading 0017; no data was changed"
        )
    op.drop_constraint(
        "uq_segment_translation_user_lang", "lesson_segment_translations", type_="unique"
    )
    op.create_unique_constraint(
        "uq_segment_translation_lang",
        "lesson_segment_translations",
        ["segment_id", "target_language_code"],
    )
    op.drop_constraint(
        "fk_segment_translation_user", "lesson_segment_translations", type_="foreignkey"
    )
    op.drop_column("lesson_segment_translations", "user_id")
    # Prior independent language preferences cannot be reconstructed; keep EN/RU values.
