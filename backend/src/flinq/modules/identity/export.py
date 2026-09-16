"""Versioned, explicit export of durable personal data.

File imports are decoded into lessons.raw_text and import-job payloads; there are
no user-owned filesystem blobs. Dictionary dumps and statistics_tracking are
instance data. Sessions, password hashes and transient rate-limit counters are
excluded. AI audit persists metadata only; sentence translations are scoped by user.

Every exported field is allowlisted: adding a model column cannot leak a secret.
Lesson children belong to the owner; reader/review activity always belongs to the
actor, even when it refers to somebody else's shared lesson.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import Base

# table -> ownership column, exported columns
USER_TABLES: dict[str, tuple[str, str]] = {
    "lesson_segment_translations": (
        "user_id",
        "id user_id segment_id target_language_code translation_text source model created_at",
    ),
    "users": ("id", "id email role is_active onboarded_at created_at deleted_at"),
    "user_profiles": (
        "user_id",
        "user_id display_name native_language_code ui_language_code timezone created_at updated_at",
    ),
    "user_settings": (
        "user_id",
        "user_id preferred_translation_language_code last_learning_language_code "
        "reader_view_mode audio_speed daily_goal_minutes daily_goal_reviews",
    ),
    "user_learning_languages": ("user_id", "id user_id language_code added_at"),
    "lessons": (
        "owner_user_id",
        "id owner_user_id language_code title raw_text word_count segment_count "
        "current_source_version visibility status created_at updated_at",
    ),
    "lesson_import_jobs": (
        "requested_by_user_id",
        "id lesson_id requested_by_user_id job_type status payload_json error_message "
        "started_at finished_at created_at",
    ),
    "token_items": (
        "user_id",
        "id user_id language_code token_text status confidence added_by "
        "created_from_lesson_id created_from_segment_id created_at updated_at",
    ),
    "phrase_items": (
        "user_id",
        "id user_id language_code phrase_text display_text status confidence added_by "
        "created_from_lesson_id created_from_segment_id created_at updated_at",
    ),
    "personal_translations": (
        "owner_user_id",
        "id owner_user_id item_kind item_id target_language_code translation_text "
        "is_primary source_type created_at",
    ),
    "personal_notes": (
        "owner_user_id",
        "id owner_user_id item_kind item_id note_text created_at updated_at",
    ),
    "item_tags": ("owner_user_id", "id owner_user_id item_kind item_id tag_name"),
    "reader_positions": (
        "user_id",
        "id user_id lesson_id view_mode current_segment_id current_token_ordinal "
        "completed_at completion_action_id last_opened_at",
    ),
    "bulk_actions": (
        "user_id",
        "id user_id lesson_id action_type page_fingerprint payload_json created_at undone_at",
    ),
    "review_items": (
        "user_id",
        "id user_id item_kind item_id language_code is_active algorithm_name "
        "algorithm_state_json due_at last_reviewed_at created_at updated_at",
    ),
    "review_events": (
        "user_id",
        "id review_item_id user_id answer_value quality previous_confidence "
        "new_confidence previous_due_at new_due_at reviewed_at",
    ),
    "ai_requests": (
        "user_id",
        "id request_id user_id lesson_id item_kind item_id provider model prompt_hash "
        "selected_text_hash input_tokens output_tokens latency_ms success error_code "
        "created_at",
    ),
    "daily_user_stats": ("user_id", "user_id date tokens_read"),
    "daily_user_language_stats": ("user_id", "user_id date language_code tokens_read"),
    "daily_read_occurrences": ("user_id", "user_id date lesson_id ordinal"),
}
LESSON_TABLES: dict[str, str] = {
    "lesson_sources": (
        "id lesson_id source_type source_uri original_filename content_hash author "
        "license source_label version_number created_at"
    ),
    "lesson_segments": ("id lesson_id ordinal segment_type text start_char_offset end_char_offset"),
    "lesson_token_occurrences": (
        "id lesson_id segment_id ordinal_in_lesson ordinal_in_segment surface_text "
        "normalized_text start_char_offset end_char_offset is_word_like"
    ),
}


async def export_user_data(session: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    tables = Base.metadata.tables
    lessons = tables["lessons"]
    lesson_ids = select(lessons.c.id).where(lessons.c.owner_user_id == user_id)
    records: dict[str, list[dict[str, Any]]] = {}
    for name, (owner_column, fields) in USER_TABLES.items():
        table = tables[name]
        result = await session.execute(
            select(*(table.c[field] for field in fields.split()))
            .where(table.c[owner_column] == user_id)
            .order_by(*table.primary_key.columns)
        )
        records[name] = [dict(row) for row in result.mappings()]
    for name, fields in LESSON_TABLES.items():
        table = tables[name]
        ownership = table.c.lesson_id.in_(lesson_ids)
        result = await session.execute(
            select(*(table.c[field] for field in fields.split()))
            .where(ownership)
            .order_by(*table.primary_key.columns)
        )
        records[name] = [dict(row) for row in result.mappings()]
    return jsonable_encoder(
        {"schema_version": 1, "exported_at": datetime.now(UTC), "data": records}
    )
