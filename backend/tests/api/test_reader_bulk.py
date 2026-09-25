"""POST /api/reader/bulk-known + POST /api/reader/bulk-actions/{id}/undo (FLQ-4.5)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.main import create_app
from glosano.modules.identity.repo import UserRepo
from glosano.modules.lesson_library.models import Lesson
from glosano.modules.reader_state.content import build_lesson_content
from glosano.modules.reader_state.models import BulkAction
from glosano.modules.reader_state.vocabulary import find_phrase_context
from glosano.modules.statistics.models import DailyUserStats
from glosano.modules.vocabulary.models import TokenItem
from tests.api._reader_helpers import register_and_onboard as _register_and_onboard
from tests.api._reader_helpers import seed_ready_lesson as _seed_ready_lesson

# Genuine Portuguese, diacritics included — mirrors test_reader_content.py fixture style.
# Distinct word-like texts (casefolded by the tokenizer): o, edifício, antigo, fica, na,
# praça, eu, gosto, dele, segundo, parágrafo, aqui — 12 distinct new words.
TEXT = "O edifício antigo fica na praça. Eu gosto dele.\n\nSegundo parágrafo aqui."


async def test_numeric_tokens_are_visible_but_not_learned_or_counted(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as c:
        email = "bulk-numbers@example.com"
        csrf = await _register_and_onboard(c, email, lang="en")
        lesson_id = await _seed_ready_lesson(
            c,
            csrf,
            monkeypatch,
            text="It's 2020. You're the most senior person on your team",
            language_code="en",
        )
        content = (await c.get(f"/api/lessons/{lesson_id}/content")).json()
        assert content["word_count"] == 9
        tokens = content["paragraphs"][0]["sentences"][0]["tokens"]
        assert any(t.get("p") == "2020" for t in tokens)
        assert not any(t.get("t") == "2020" for t in tokens)
        lesson = await db_session.get(Lesson, lesson_id)
        assert lesson is not None and lesson.word_count == 9
        model = await build_lesson_content(db_session, lesson)
        assert find_phrase_context(model, "it's 2020") is not None
        assert find_phrase_context(model, "it's 2021") is None
        r = await c.post(
            "/api/reader/bulk-known",
            json={"lesson_id": str(lesson_id), "from_ordinal": 0, "to_ordinal": 1000},
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 200
        assert r.json()["created_count"] == 9
        statuses = (await c.get(f"/api/lessons/{lesson_id}/token-statuses")).json()["statuses"]
        assert len(statuses) == 9 and "2020" not in statuses
        user = await UserRepo(db_session).get_by_email(email)
        assert user is not None
        assert (
            await db_session.scalar(
                select(DailyUserStats.tokens_read).where(DailyUserStats.user_id == user.id)
            )
            == 9
        )


@pytest.fixture(autouse=True)
async def _clean(  # pyright: ignore[reportUnusedFunction] — autouse fixture
    db_session: AsyncSession,
) -> AsyncIterator[None]:
    yield
    await db_session.execute(delete(BulkAction))
    await db_session.execute(delete(TokenItem))
    await db_session.commit()


async def test_bulk_known_full_range_creates_distinct_new_words(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await _register_and_onboard(c, "bulk-full@example.com", lang="pt")
        lesson_id = await _seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        r = await c.get(f"/api/lessons/{lesson_id}/content")
        assert r.status_code == 200
        word_count = r.json()["word_count"]
        assert word_count == 12

        r = await c.post(
            "/api/reader/bulk-known",
            json={"lesson_id": str(lesson_id), "from_ordinal": 0, "to_ordinal": 1000},
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["created_count"] == 12
        action_id = body["action_id"]
        assert uuid.UUID(action_id)

        r = await c.get(f"/api/lessons/{lesson_id}/token-statuses")
        assert r.status_code == 200
        statuses = r.json()["statuses"]
        assert len(statuses) == 12
        assert all(s["s"] == "known" for s in statuses.values())
        assert "edifício" in statuses
        assert "parágrafo" in statuses


async def test_bulk_known_leaves_pre_seeded_tracked_item_untouched(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        email = "bulk-tracked@example.com"
        csrf = await _register_and_onboard(c, email, lang="pt")
        lesson_id = await _seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        async with session_scope() as s:
            user = await UserRepo(s).get_by_email(email)
            assert user is not None
            user_id = user.id
            tracked = TokenItem(
                user_id=user_id,
                language_code="pt",
                token_text="praça",
                status="tracked",
                confidence=2,
            )
            s.add(tracked)
            await s.flush()
            tracked_id = tracked.id

        r = await c.post(
            "/api/reader/bulk-known",
            json={"lesson_id": str(lesson_id), "from_ordinal": 0, "to_ordinal": 1000},
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["created_count"] == 11  # 12 words minus the pre-seeded "praça"

        action = await db_session.get(BulkAction, uuid.UUID(body["action_id"]))
        assert action is not None
        created_ids = action.payload_json["token_item_ids"]
        assert str(tracked_id) not in created_ids

        tracked_after = await db_session.get(TokenItem, tracked_id)
        assert tracked_after is not None
        assert tracked_after.status == "tracked"
        assert tracked_after.confidence == 2


async def test_bulk_known_repeat_same_range_creates_nothing(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await _register_and_onboard(c, "bulk-repeat@example.com", lang="pt")
        lesson_id = await _seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        r = await c.post(
            "/api/reader/bulk-known",
            json={"lesson_id": str(lesson_id), "from_ordinal": 0, "to_ordinal": 1000},
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 200
        assert r.json()["created_count"] == 12

        row_count_after_first = len((await db_session.scalars(select(TokenItem))).all())

        r = await c.post(
            "/api/reader/bulk-known",
            json={"lesson_id": str(lesson_id), "from_ordinal": 0, "to_ordinal": 1000},
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 200
        assert r.json()["created_count"] == 0

        row_count_after_second = len((await db_session.scalars(select(TokenItem))).all())
        assert row_count_after_second == row_count_after_first


async def test_undo_deletes_items_then_second_undo_409(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await _register_and_onboard(c, "bulk-undo@example.com", lang="pt")
        lesson_id = await _seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        r = await c.post(
            "/api/reader/bulk-known",
            json={"lesson_id": str(lesson_id), "from_ordinal": 0, "to_ordinal": 1000},
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 200
        action_id = r.json()["action_id"]
        assert r.json()["created_count"] == 12

        r = await c.post(
            f"/api/reader/bulk-actions/{action_id}/undo",
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 200
        assert r.json()["undone_count"] == 12

        r = await c.get(f"/api/lessons/{lesson_id}/token-statuses")
        assert r.status_code == 200
        assert r.json()["statuses"] == {}

        r = await c.post(
            f"/api/reader/bulk-actions/{action_id}/undo",
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 409
        assert r.json() == {"detail": "already_undone"}


async def test_undo_after_manual_flip_survives_that_item(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await _register_and_onboard(c, "bulk-flip@example.com", lang="pt")
        lesson_id = await _seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        r = await c.post(
            "/api/reader/bulk-known",
            json={"lesson_id": str(lesson_id), "from_ordinal": 0, "to_ordinal": 1000},
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 200
        action_id = r.json()["action_id"]
        action = await db_session.get(BulkAction, uuid.UUID(action_id))
        assert action is not None
        created_ids = [uuid.UUID(x) for x in action.payload_json["token_item_ids"]]
        assert len(created_ids) == 12
        flipped_id = created_ids[0]

        async with session_scope() as s:
            item = await s.get(TokenItem, flipped_id)
            assert item is not None
            item.status = "tracked"
            item.confidence = 1

        r = await c.post(
            f"/api/reader/bulk-actions/{action_id}/undo",
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 200
        assert r.json()["undone_count"] == 11

        survivor = await db_session.get(TokenItem, flipped_id)
        assert survivor is not None
        assert survivor.status == "tracked"
        assert survivor.confidence == 1

        remaining_created = [i for i in created_ids if i != flipped_id]
        for item_id in remaining_created:
            assert await db_session.get(TokenItem, item_id) is None


async def test_undo_foreign_action_and_unknown_action_404(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport = ASGITransport(app=create_app())

    async with AsyncClient(transport=transport, base_url="http://test") as owner_client:
        owner_csrf = await _register_and_onboard(owner_client, "bulk-owner@example.com")
        lesson_id = await _seed_ready_lesson(owner_client, owner_csrf, monkeypatch, text=TEXT)

        r = await owner_client.post(
            "/api/reader/bulk-known",
            json={"lesson_id": str(lesson_id), "from_ordinal": 0, "to_ordinal": 1000},
            headers={"X-CSRF-Token": owner_csrf},
        )
        assert r.status_code == 200
        action_id = r.json()["action_id"]

    async with AsyncClient(transport=transport, base_url="http://test") as other_client:
        other_csrf = await _register_and_onboard(other_client, "bulk-other@example.com")

        r = await other_client.post(
            f"/api/reader/bulk-actions/{action_id}/undo",
            headers={"X-CSRF-Token": other_csrf},
        )
        assert r.status_code == 404

        r = await other_client.post(
            f"/api/reader/bulk-actions/{uuid.uuid4()}/undo",
            headers={"X-CSRF-Token": other_csrf},
        )
        assert r.status_code == 404
