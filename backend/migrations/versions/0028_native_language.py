"""Seed the native language as translation target (FLQ-47)."""

from alembic import op

revision = "0028_native_language"
down_revision = "0027_external_dictionaries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # For onboarded users the UI language becomes native unless they learn it; those
    # users stay NULL and are sent back through onboarding to pick a native language.
    # Never-onboarded users also stay NULL and choose it in onboarding.
    op.execute(
        """
        UPDATE user_profiles AS profile
        SET native_language_code = profile.ui_language_code
        FROM users
        WHERE users.id = profile.user_id
          AND users.onboarded_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM user_learning_languages AS learning
            WHERE learning.user_id = profile.user_id
              AND learning.language_code = profile.ui_language_code
        )
        """
    )
    op.execute(
        """
        UPDATE user_settings AS settings
        SET preferred_translation_language_code = profile.native_language_code
        FROM user_profiles AS profile
        WHERE profile.user_id = settings.user_id
          AND profile.native_language_code IS NOT NULL
        """
    )


def downgrade() -> None:
    # ADR-0011 state: the translation target follows the UI language.
    op.execute(
        """
        UPDATE user_settings AS settings
        SET preferred_translation_language_code = profile.ui_language_code
        FROM user_profiles AS profile
        WHERE profile.user_id = settings.user_id
        """
    )
    # The column was never written before 0028, so clearing it loses nothing.
    op.execute("UPDATE user_profiles SET native_language_code = NULL")
