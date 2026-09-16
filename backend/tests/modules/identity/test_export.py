"""All durable personal data is portable; other users and credentials stay private."""

import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy import select

from flinq.core.db import Base, session_scope
from flinq.core.security import hash_password
from flinq.modules.ai_translation.models import AIRequest
from flinq.modules.dictionary.models import DictionaryEntry, DictionarySourceVersion
from flinq.modules.identity.models import User, UserSession
from flinq.modules.identity.repo import UserRepo
from flinq.modules.lesson_library.models import (
    Lesson,
    LessonImportJob,
    LessonMediaSource,
    LessonSegment,
    LessonSource,
    LessonTokenOccurrence,
)
from flinq.modules.reader_state.models import BulkAction, LessonSegmentTranslation, ReaderPosition
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.statistics.models import (
    DailyReadOccurrence,
    DailyUserLanguageStats,
    DailyUserStats,
)
from flinq.modules.vocabulary.models import (
    ItemTag,
    PersonalNote,
    PersonalTranslation,
    PhraseItem,
    TokenItem,
)
from tests.api.test_me_settings import register


async def seed_data(user_id: uuid.UUID) -> dict[str, str]:
    async with session_scope() as s:
        own = Lesson(
            owner_user_id=user_id, language_code="pt", title="My lesson", raw_text="cada dia"
        )
        other = await UserRepo(s).create(
            email=f"{uuid.uuid4()}@other.test",
            password_hash=hash_password("secret-other"),
            display_name="Other",
        )
        foreign = Lesson(
            owner_user_id=other.id,
            language_code="en",
            title="Not mine",
            raw_text="private data",
            visibility="shared",
        )
        s.add_all([own, foreign])
        await s.flush()
        segment = LessonSegment(
            lesson_id=own.id, ordinal=0, text="cada dia", start_char_offset=0, end_char_offset=8
        )
        s.add(segment)
        await s.flush()
        media_source = LessonSource(
            lesson_id=own.id, source_type="youtube", content_hash="video", version_number=2
        )
        s.add(media_source)
        await s.flush()
        s.add(
            LessonMediaSource(
                source_id=media_source.id,
                lesson_id=own.id,
                video_id="M7lc1UVf-VE",
                canonical_url="https://www.youtube.com/watch?v=M7lc1UVf-VE",
                title="Video",
                author=None,
                language_code="pt",
                is_generated=False,
                cue_snapshot=[{"text": "cada dia", "start_ms": 0, "end_ms": 1000}],
            )
        )
        token = TokenItem(
            user_id=user_id,
            language_code="pt",
            token_text="cada",
            status="tracked",
            confidence=1,
            created_from_lesson_id=own.id,
        )
        phrase = PhraseItem(
            user_id=user_id,
            language_code="pt",
            phrase_text="cada dia",
            display_text="cada dia",
            status="known",
        )
        s.add_all([token, phrase])
        await s.flush()
        review = ReviewItem(
            user_id=user_id,
            item_kind="token",
            item_id=token.id,
            language_code="pt",
            algorithm_state_json={"interval": 1},
            due_at=datetime.now(UTC),
        )
        s.add(review)
        await s.flush()
        today = datetime.now(UTC).date()
        s.add(DailyUserStats(user_id=user_id, date=today, tokens_read=2))
        await s.flush()
        s.add_all(
            [
                LessonSource(lesson_id=own.id, content_hash="a" * 64, original_filename="my.txt"),
                LessonImportJob(
                    lesson_id=own.id,
                    requested_by_user_id=user_id,
                    payload_json={"text": "cada dia"},
                ),
                LessonTokenOccurrence(
                    lesson_id=own.id,
                    segment_id=segment.id,
                    ordinal_in_lesson=0,
                    ordinal_in_segment=0,
                    surface_text="cada",
                    normalized_text="cada",
                    start_char_offset=0,
                    end_char_offset=4,
                ),
                LessonSegmentTranslation(
                    user_id=user_id,
                    segment_id=segment.id,
                    target_language_code="en",
                    translation_text="every day",
                    model="model",
                ),
                PersonalTranslation(
                    owner_user_id=user_id,
                    item_kind="token",
                    item_id=token.id,
                    target_language_code="ru",
                    translation_text="Saved translation",
                    source_type="user",
                    is_primary=True,
                ),
                PersonalNote(
                    owner_user_id=user_id,
                    item_kind="phrase",
                    item_id=phrase.id,
                    note_text="My note",
                ),
                ItemTag(
                    owner_user_id=user_id, item_kind="token", item_id=token.id, tag_name="mine"
                ),
                ReaderPosition(user_id=user_id, lesson_id=foreign.id, current_token_ordinal=3),
                BulkAction(
                    user_id=user_id,
                    lesson_id=own.id,
                    page_fingerprint="f" * 64,
                    payload_json={"test": 1},
                ),
                ReviewEvent(
                    review_item_id=review.id,
                    user_id=user_id,
                    answer_value="correct",
                    previous_due_at=datetime.now(UTC),
                    new_due_at=datetime.now(UTC),
                ),
                AIRequest(
                    request_id=uuid.uuid4(),
                    user_id=user_id,
                    provider="example.com",
                    model="model",
                    prompt_hash="p" * 64,
                    selected_text_hash="s" * 64,
                    latency_ms=10,
                    success=True,
                ),
                DailyUserLanguageStats(
                    user_id=user_id, date=today, language_code="pt", tokens_read=2
                ),
                DailyReadOccurrence(user_id=user_id, date=today, lesson_id=own.id, ordinal=0),
            ]
        )
        return {
            "lesson": str(own.id),
            "foreign": str(foreign.id),
            "other": str(other.id),
            "token": str(token.id),
        }


async def test_export_is_complete_and_isolated(client: AsyncClient):
    user_id, email = await register(client)
    csrf = client.cookies.get("flinq_csrf")
    session_token = client.cookies.get("flinq_session")
    assert csrf and session_token
    await client.post("/me/onboarding", json={"ui_language": "en", "learning_languages": ["pt"]})
    ids = await seed_data(uuid.UUID(user_id))
    response = await client.get("/me/export")
    assert response.status_code == 200
    assert "attachment;" in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    assert data["schema_version"] == 1
    assert datetime.fromisoformat(data["exported_at"]).tzinfo
    records = data["data"]
    assert records["users"][0]["email"] == email
    assert records["lessons"][0]["id"] == ids["lesson"]
    assert len(records["lessons"]) == 1
    assert records["lessons"][0]["raw_text"] == "cada dia"
    assert records["reader_positions"][0]["lesson_id"] == ids["foreign"]
    assert records["personal_translations"][0]["translation_text"] == "Saved translation"
    assert records["daily_user_stats"][0]["tokens_read"] == 2
    for table in records:
        assert records[table], table
    # Explicit classification catches any new table omitted from the privacy/export audit.
    excluded = {
        "user_sessions",
        "statistics_tracking",
        "dictionary_entries",
        "dictionary_translations",
        "dictionary_examples",
        "dictionary_source_versions",
    }
    assert set(records) | excluded == set(Base.metadata.tables)
    for secret in [
        "password_hash",
        "secret-other",
        session_token,
        csrf,
        "Not mine",
        "private data",
    ]:
        assert secret not in response.text


async def test_delete_removes_all_owned_data_and_preserves_other_users(client: AsyncClient):
    user_id, _ = await register(client)
    ids = await seed_data(uuid.UUID(user_id))
    async with session_scope() as s:
        version = DictionarySourceVersion(
            source_name="Wiktionary",
            source_language_code="pt",
            target_language_code="en",
            source_version="export-delete-test",
            status="importing",
        )
        s.add(version)
        await s.flush()
        s.add(
            DictionaryEntry(
                source_version_id=version.id,
                source_language_code="pt",
                headword="cada",
                headword_normalized="cada",
                entry_key="cada-test",
            )
        )
        await s.flush()
        dictionary_before = set((await s.scalars(select(DictionaryEntry.id))).all())
        assert dictionary_before
    bad = await client.request("DELETE", "/me", json={"password": "wrong"})
    assert bad.status_code == 401
    assert (await client.get("/me")).status_code == 200
    response = await client.request("DELETE", "/me", json={"password": "abcdefghij"})
    assert response.status_code == 200
    assert (await client.get("/me")).status_code == 401
    async with session_scope() as s:
        assert await s.get(User, uuid.UUID(user_id)) is None
        assert await s.get(User, uuid.UUID(ids["other"])) is not None
        assert await s.get(Lesson, uuid.UUID(ids["foreign"])) is not None
        assert await s.get(Lesson, uuid.UUID(ids["lesson"])) is None
        assert set((await s.scalars(select(DictionaryEntry.id))).all()) == dictionary_before
        for table in Base.metadata.sorted_tables:
            for column in ("user_id", "owner_user_id", "requested_by_user_id"):
                if column in table.c:
                    assert not (
                        await s.execute(select(table).where(table.c[column] == uuid.UUID(user_id)))
                    ).first(), table.name
        assert not (
            await s.execute(select(UserSession).where(UserSession.user_id == uuid.UUID(user_id)))
        ).first()


async def test_export_requires_auth(client: AsyncClient):
    assert (await client.get("/me/export")).status_code == 401


async def test_removing_learning_language_preserves_personal_data(client: AsyncClient):
    user_id, _ = await register(client)
    await client.post("/me/onboarding", json={"ui_language": "en", "learning_languages": ["pt"]})
    ids = await seed_data(uuid.UUID(user_id))
    response = await client.patch(
        "/me/preferences",
        json={
            "ui_language": "ru",
            "learning_languages": ["en"],
            "daily_goal_minutes": 15,
            "daily_goal_reviews": 2,
        },
    )
    assert response.status_code == 200
    assert response.json()["last_learning_language_code"] == "en"
    exported = (await client.get("/me/export")).json()["data"]
    assert exported["lessons"][0]["id"] == ids["lesson"]
    assert exported["token_items"][0]["id"] == ids["token"]
    assert exported["personal_translations"][0]["translation_text"] == "Saved translation"
    assert exported["review_items"] and exported["review_events"]
    assert exported["daily_user_stats"][0]["tokens_read"] == 2
