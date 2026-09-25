"""Exclude tokens without letters from learning and repair derived counts (ADR-0017)."""

import unicodedata

import sqlalchemy as sa
from alembic import op

revision = "0024_numeric_tokens"
down_revision = "0023_item_tag_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    # Freeze the Unicode rule in the migration; PostgreSQL regex character classes
    # depend on database locale and must not disagree with Python's tokenizer.
    occurrences = connection.execute(
        sa.text("SELECT id, surface_text FROM lesson_token_occurrences WHERE is_word_like")
    )
    for batch in occurrences.partitions(1000):
        ids = [
            row.id
            for row in batch
            if not any(char.isalpha() for char in unicodedata.normalize("NFC", row.surface_text))
        ]
        if ids:
            connection.execute(
                sa.text("""
                WITH changed AS (
                    UPDATE lesson_token_occurrences SET is_word_like = false
                    WHERE id IN :ids RETURNING lesson_id
                ), counts AS (
                    SELECT lesson_id, count(*) AS n FROM changed GROUP BY lesson_id
                )
                UPDATE lessons SET word_count = GREATEST(0, word_count - counts.n)
                FROM counts WHERE lessons.id = counts.lesson_id
            """).bindparams(sa.bindparam("ids", expanding=True)),
                {"ids": ids},
            )

    # Only subtract identifiable numeric reads. Deleted/replaced lessons have no
    # corresponding occurrences; their historical totals must not be recomputed.
    connection.execute(
        sa.text("""
        WITH removed AS (
            DELETE FROM daily_read_occurrences AS r
            USING lesson_token_occurrences AS o, lessons AS l
            WHERE r.lesson_id = o.lesson_id AND r.ordinal = o.ordinal_in_lesson
              AND NOT o.is_word_like AND l.id = o.lesson_id
            RETURNING r.user_id, r.date, l.language_code
        ), per_language AS (
            SELECT user_id, date, language_code, count(*) AS n
            FROM removed GROUP BY user_id, date, language_code
        ), languages_updated AS (
            UPDATE daily_user_language_stats AS s
            SET tokens_read = GREATEST(0, s.tokens_read - r.n)
            FROM per_language AS r
            WHERE s.user_id = r.user_id AND s.date = r.date
              AND s.language_code = r.language_code
        ), per_user AS (
            SELECT user_id, date, count(*) AS n FROM removed GROUP BY user_id, date
        )
        UPDATE daily_user_stats AS s SET tokens_read = GREATEST(0, s.tokens_read - r.n)
        FROM per_user AS r WHERE s.user_id = r.user_id AND s.date = r.date
    """)
    )

    # Preserve identities and all explicit user decisions. Untouched bulk-known
    # numbers become ignored, so they no longer inflate known-word statistics.
    items = connection.execute(
        sa.text("""
        SELECT t.id, t.token_text FROM token_items AS t
        WHERE t.added_by = 'bulk' AND t.status = 'known'
          AND NOT EXISTS (SELECT 1 FROM personal_translations p
                          WHERE p.item_kind = 'token' AND p.item_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM personal_notes p
                          WHERE p.item_kind = 'token' AND p.item_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM item_tags p
                          WHERE p.item_kind = 'token' AND p.item_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM review_items p
                          WHERE p.item_kind = 'token' AND p.item_id = t.id)
    """)
    )
    for batch in items.partitions(1000):
        ids = [
            row.id
            for row in batch
            if not any(char.isalpha() for char in unicodedata.normalize("NFC", row.token_text))
        ]
        if ids:
            connection.execute(
                sa.text("""
                UPDATE token_items SET status = 'ignored', updated_at = now() WHERE id IN :ids
            """).bindparams(sa.bindparam("ids", expanding=True)),
                {"ids": ids},
            )


def downgrade() -> None:
    # Data correction only: never reintroduce inflated counts or overwrite later
    # user actions. Schema is unchanged; restore a backup to undo the correction.
    pass
