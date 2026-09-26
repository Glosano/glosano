"""Owner material management, including preservation of learning data (FLQ-26)."""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from glosano.core.db import session_scope
from glosano.main import create_app
from glosano.modules.lesson_library.models import Lesson, LessonSegment, LessonSource
from glosano.modules.reader_state.models import BulkAction, ReaderPosition
from glosano.modules.review.models import ReviewItem
from glosano.modules.statistics.models import DailyReadOccurrence, DailyUserStats
from glosano.modules.vocabulary.models import PhraseItem, TokenItem

from ._reader_helpers import library_items, register_and_onboard, seed_ready_lesson


@pytest.fixture
async def material(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com")
    lesson_id = await seed_ready_lesson(client, csrf, monkeypatch, text="Olá mundo.")
    return lesson_id, {"X-CSRF-Token": csrf}


async def test_owner_can_load_original_text(client: AsyncClient, material):
    lesson_id, _ = material
    response = await client.get(f"/api/lessons/{lesson_id}/edit")
    assert response.status_code == 200
    assert response.json()["raw_text"] == "Olá mundo."
    listing = await library_items(client)
    assert next(x for x in listing if x["id"] == str(lesson_id))["can_manage"]


@pytest.mark.parametrize("change_text", [False, True])
async def test_edit_versions_text_and_preserves_learning_data(
    client: AsyncClient, material, change_text: bool
):
    lesson_id, headers = material
    today = datetime.now(UTC).date()
    async with session_scope() as s:
        lesson = await s.get(Lesson, lesson_id)
        user_id = lesson.owner_user_id
        segment = (
            await s.scalars(select(LessonSegment).where(LessonSegment.lesson_id == lesson_id))
        ).one()
        segment_id = segment.id
        token = TokenItem(
            user_id=user_id,
            language_code="pt",
            token_text="olá",
            status="tracked",
            confidence=1,
            created_from_lesson_id=lesson_id,
            created_from_segment_id=segment_id,
        )
        s.add(token)
        await s.flush()
        token_id = token.id
        s.add_all(
            [
                ReaderPosition(user_id=user_id, lesson_id=lesson_id, current_token_ordinal=1),
                BulkAction(user_id=user_id, lesson_id=lesson_id, page_fingerprint="old"),
                DailyUserStats(user_id=user_id, date=today, tokens_read=2),
                DailyReadOccurrence(user_id=user_id, date=today, lesson_id=lesson_id, ordinal=0),
                ReviewItem(
                    user_id=user_id,
                    item_kind="token",
                    item_id=token_id,
                    language_code="pt",
                    due_at=datetime.now(UTC),
                    algorithm_state_json={},
                ),
            ]
        )
    text = "Bom dia.\r\nAté amanhã." if change_text else "Olá mundo."
    response = await client.patch(
        f"/api/lessons/{lesson_id}", headers=headers, json={"title": "New title", "raw_text": text}
    )
    assert response.status_code == 200
    detail = (await client.get(f"/api/lessons/{lesson_id}/edit")).json()
    assert detail["title"] == "New title"
    assert detail["raw_text"] == text.replace("\r\n", "\n")
    async with session_scope() as s:
        lesson = await s.get(Lesson, lesson_id)
        assert lesson.status == "ready"
        assert lesson.current_source_version == (2 if change_text else 1)
        assert lesson.word_count == (4 if change_text else 2)
        sources = (
            await s.scalars(select(LessonSource).where(LessonSource.lesson_id == lesson_id))
        ).all()
        assert len(sources) == (2 if change_text else 1)
        position = (
            await s.scalars(select(ReaderPosition).where(ReaderPosition.lesson_id == lesson_id))
        ).one_or_none()
        assert (position is None) == change_text
        assert (await s.get(LessonSegment, segment_id) is None) == change_text
        actions = (
            await s.scalars(select(BulkAction).where(BulkAction.lesson_id == lesson_id))
        ).all()
        assert len(actions) == (0 if change_text else 1)
        assert (await s.get(DailyUserStats, (user_id, today))).tokens_read == 2
        assert (await s.get(TokenItem, token_id)).status == "tracked"
        assert (await s.scalars(select(ReviewItem).where(ReviewItem.item_id == token_id))).one()
        ledger = await s.get(DailyReadOccurrence, (user_id, today, lesson_id, 0))
        assert (ledger is None) == change_text
    content = await client.get(f"/api/lessons/{lesson_id}/content")
    assert content.status_code == 200
    assert ("Bom" in content.text) == change_text


async def test_delete_preserves_vocabulary_reviews_and_totals(client: AsyncClient, material):
    lesson_id, headers = material
    today = datetime.now(UTC).date()
    async with session_scope() as s:
        user_id = (await s.get(Lesson, lesson_id)).owner_user_id
        token = TokenItem(
            user_id=user_id,
            language_code="pt",
            token_text="olá",
            status="tracked",
            confidence=1,
            created_from_lesson_id=lesson_id,
        )
        phrase = PhraseItem(
            user_id=user_id,
            language_code="pt",
            phrase_text="olá mundo",
            display_text="Olá mundo",
            status="tracked",
            confidence=1,
            created_from_lesson_id=lesson_id,
        )
        s.add_all([token, phrase])
        await s.flush()
        ids = token.id, phrase.id
        s.add_all(
            [
                ReviewItem(
                    user_id=user_id,
                    item_kind=kind,
                    item_id=item_id,
                    language_code="pt",
                    due_at=datetime.now(UTC),
                    algorithm_state_json={},
                )
                for kind, item_id in zip(("token", "phrase"), ids, strict=True)
            ]
        )
        s.add(DailyUserStats(user_id=user_id, date=today, tokens_read=2))
    response = await client.delete(f"/api/lessons/{lesson_id}", headers=headers)
    assert response.status_code == 204
    assert (await client.get(f"/api/lessons/{lesson_id}")).status_code == 404
    assert (await client.get(f"/api/lessons/{lesson_id}/content")).status_code == 404
    assert str(lesson_id) not in {x["id"] for x in await library_items(client)}
    async with session_scope() as s:
        for model, item_id in zip((TokenItem, PhraseItem), ids, strict=True):
            item = await s.get(model, item_id)
            assert item.status == "tracked"
            assert item.created_from_lesson_id is None
            assert (await s.scalars(select(ReviewItem).where(ReviewItem.item_id == item_id))).one()
        assert (await s.get(DailyUserStats, (user_id, today))).tokens_read == 2
        assert not (
            await s.scalars(select(LessonSource).where(LessonSource.lesson_id == lesson_id))
        ).all()


@pytest.mark.parametrize("visibility", ["private", "shared"])
async def test_other_users_cannot_manage_material(client: AsyncClient, material, visibility: str):
    lesson_id, _ = material
    async with session_scope() as s:
        (await s.get(Lesson, lesson_id)).visibility = visibility
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as other:
        csrf = await register_and_onboard(other, f"{uuid.uuid4()}@example.com")
        assert (await other.get(f"/api/lessons/{lesson_id}/edit")).status_code == 404
        headers = {"X-CSRF-Token": csrf}
        assert (
            await other.patch(
                f"/api/lessons/{lesson_id}",
                headers=headers,
                json={"title": "Stolen", "raw_text": "No"},
            )
        ).status_code == 404
        assert (await other.delete(f"/api/lessons/{lesson_id}", headers=headers)).status_code == 404
        if visibility == "shared":
            listing = await library_items(other)
            assert not next(x for x in listing if x["id"] == str(lesson_id))["can_manage"]
    assert (await client.get(f"/api/lessons/{lesson_id}")).status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"title": "   ", "raw_text": "text"},
        {"title": "Title", "raw_text": " \n "},
        {"title": "x" * 201, "raw_text": "text"},
        {"title": "Title", "raw_text": "x\u0000y"},
    ],
)
async def test_invalid_edit_leaves_material_unchanged(client: AsyncClient, material, body):
    lesson_id, headers = material
    assert (
        await client.patch(f"/api/lessons/{lesson_id}", headers=headers, json=body)
    ).status_code == 422
    assert (await client.get(f"/api/lessons/{lesson_id}/edit")).json()["raw_text"] == "Olá mundo."


async def test_mutations_require_csrf(client: AsyncClient, material):
    lesson_id, _ = material
    assert (await client.delete(f"/api/lessons/{lesson_id}")).status_code == 403
    assert (
        await client.patch(f"/api/lessons/{lesson_id}", json={"title": "Title", "raw_text": "Text"})
    ).status_code == 403


async def test_old_reader_cannot_apply_ordinals_to_replacement_text(client: AsyncClient, material):
    lesson_id, headers = material
    response = await client.patch(
        f"/api/lessons/{lesson_id}", headers=headers, json={"title": "New", "raw_text": "Bom dia."}
    )
    assert response.status_code == 200
    for version in ({}, {"source_version": 1}):
        bulk = await client.post(
            "/api/reader/bulk-known",
            headers=headers,
            json={
                "lesson_id": str(lesson_id),
                "from_ordinal": 0,
                "to_ordinal": 1,
                **version,
            },
        )
        assert bulk.status_code == 409
        assert bulk.json()["detail"] == "lesson_version_changed"
        position = await client.put(
            "/api/reader/positions",
            headers=headers,
            json={
                "lesson_id": str(lesson_id),
                "view_mode": "page",
                "current_segment_id": None,
                "current_token_ordinal": 1,
                **version,
            },
        )
        assert position.status_code == 409
    content = (await client.get(f"/api/lessons/{lesson_id}/content")).json()
    assert content["source_version"] == 2
    current = await client.post(
        "/api/reader/bulk-known",
        headers=headers,
        json={
            "lesson_id": str(lesson_id),
            "source_version": 2,
            "from_ordinal": 0,
            "to_ordinal": 1,
        },
    )
    assert current.status_code == 200
    assert current.json()["created_count"] == 2


async def test_failed_processing_rolls_back_the_entire_edit(
    client: AsyncClient, material, monkeypatch
):
    from glosano.modules.lesson_library import service

    lesson_id, headers = material

    async def fail(*args, **kwargs):
        raise RuntimeError("processing failed")

    monkeypatch.setattr(service, "process_lesson_import", fail)
    with pytest.raises(RuntimeError, match="processing failed"):
        await client.patch(
            f"/api/lessons/{lesson_id}",
            headers=headers,
            json={"title": "Must roll back", "raw_text": "Changed."},
        )
    detail = (await client.get(f"/api/lessons/{lesson_id}/edit")).json()
    assert detail["raw_text"] == "Olá mundo."
    assert detail["title"] == "Reader fixture"
    async with session_scope() as s:
        assert (await s.get(Lesson, lesson_id)).current_source_version == 1


async def test_delete_during_pending_import_is_safe_for_late_worker(client: AsyncClient, material):
    from glosano.modules.lesson_library.models import LessonImportJob
    from glosano.worker.tasks import run_lesson_import

    lesson_id, headers = material
    async with session_scope() as s:
        (await s.get(Lesson, lesson_id)).status = "processing"
        job_id = (
            await s.scalars(
                select(LessonImportJob.id).where(LessonImportJob.lesson_id == lesson_id)
            )
        ).one()
    assert (
        await client.patch(
            f"/api/lessons/{lesson_id}",
            headers=headers,
            json={"title": "Blocked", "raw_text": "Changed."},
        )
    ).status_code == 409
    assert (await client.delete(f"/api/lessons/{lesson_id}", headers=headers)).status_code == 204
    await run_lesson_import(lesson_id, job_id)
    assert (await client.get(f"/api/lessons/{lesson_id}")).status_code == 404
