"""Confirmed completion is personal, repeatable and undoable."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.db import session_scope
from flinq.main import create_app
from flinq.modules.identity.export import export_user_data
from flinq.modules.identity.repo import UserRepo
from flinq.modules.reader_state.models import BulkAction
from flinq.modules.statistics.models import DailyReadOccurrence
from flinq.modules.vocabulary.models import PhraseItem, TokenItem
from tests.api._reader_helpers import register_and_onboard, seed_ready_lesson


@pytest.mark.parametrize("mode", ["page", "sentence"])
async def test_complete_last_fragment_preserves_statuses_and_undo(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as c:
        email = f"complete-{mode}@example.com"
        csrf = await register_and_onboard(c, email)
        headers = {"X-CSRF-Token": csrf}
        lesson = await seed_ready_lesson(
            c, csrf, monkeypatch, text="Antes. Novo estudo ignoro sei."
        )
        content = (await c.get(f"/api/lessons/{lesson}/content")).json()
        last = content["paragraphs"][-1]["sentences"][-1]
        words = [t for t in last["tokens"] if "i" in t]
        async with session_scope() as s:
            user = await UserRepo(s).get_by_email(email)
            assert user
            user_id = user.id
            for term, state in [("estudo", "tracked"), ("ignoro", "ignored"), ("sei", "known")]:
                s.add(
                    TokenItem(
                        user_id=user.id,
                        language_code="pt",
                        token_text=term,
                        status=state,
                        confidence=2 if state == "tracked" else None,
                    )
                )
        payload = {
            "lesson_id": str(lesson),
            "source_version": 1,
            "view_mode": mode,
            "last_segment_id": last["seg_id"],
            "from_ordinal": words[0]["i"],
            "to_ordinal": words[-1]["i"],
        }
        responses = await asyncio.gather(
            *[c.post("/api/reader/complete", json=payload, headers=headers) for _ in range(2)]
        )
        assert [r.status_code for r in responses] == [200, 200]
        result = responses[0].json()
        assert responses[1].json() == result
        assert result["created_count"] == 1
        assert result["completed_at"]
        assert result["summary"] == {
            "total_words": 5,
            "unique_words": 5,
            "known_words": 1,
            "new_words": 2,
            "tracked_words": 1,
            "ignored_words": 1,
            "added_words": 0,
            "added_phrases": 0,
            "reading_days": 1,
            "marked_known_words": 1,
        }
        summary_url = f"/api/lessons/{lesson}/completion-summary"
        saved = await c.get(summary_url)
        assert saved.status_code == 200
        assert saved.json() == result
        stale = await c.get(summary_url, params={"action_id": str(uuid.uuid4())})
        assert stale.status_code == 409
        assert stale.json()["detail"] == "completion_changed"
        async with session_scope() as s:
            exported = await export_user_data(s, user_id)
        position = next(
            row for row in exported["data"]["reader_positions"] if row["lesson_id"] == str(lesson)
        )
        assert datetime.fromisoformat(position["completed_at"]) == datetime.fromisoformat(
            result["completed_at"]
        )
        assert position["completion_action_id"] == result["action_id"]
        statuses = (await c.get(f"/api/lessons/{lesson}/token-statuses")).json()["statuses"]
        assert "antes" not in statuses
        assert statuses["novo"]["s"] == "known"
        assert statuses["estudo"] == {"s": "tracked", "c": 2}
        assert statuses["ignoro"]["s"] == "ignored"
        assert statuses["sei"]["s"] == "known"
        assert (
            await db_session.scalar(
                select(func.count()).select_from(BulkAction).where(BulkAction.lesson_id == lesson)
            )
            == 1
        )
        assert (
            await db_session.scalar(
                select(func.count())
                .select_from(DailyReadOccurrence)
                .where(DailyReadOccurrence.lesson_id == lesson)
            )
            == 4
        )
        # A late autosave must not erase completion.
        r = await c.put(
            "/api/reader/positions",
            headers=headers,
            json={
                "lesson_id": str(lesson),
                "source_version": 1,
                "view_mode": mode,
                "current_segment_id": last["seg_id"],
                "current_token_ordinal": 0,
            },
        )
        assert r.status_code == 204
        detail = (await c.get(f"/api/lessons/{lesson}")).json()
        assert detail["reader_position"]["completed_at"] == result["completed_at"]
        assert detail["reader_position"]["completion_action_id"] == result["action_id"]
        listing = (await c.get("/api/lessons", params={"lang": "pt"})).json()
        card = next(row for row in listing["items"] if row["id"] == str(lesson))
        assert card["completed_at"] == result["completed_at"]
        assert card["read_percent"] == 100
        r = await c.post(f"/api/reader/bulk-actions/{result['action_id']}/undo", headers=headers)
        assert r.status_code == 200
        assert r.json()["undone_count"] == 1
        detail = (await c.get(f"/api/lessons/{lesson}")).json()
        assert detail["reader_position"]["completed_at"] is None
        assert (await c.get(summary_url)).status_code == 404
        assert detail["reader_position"]["completion_action_id"] is None
        assert (
            await db_session.scalar(
                select(func.count())
                .select_from(DailyReadOccurrence)
                .where(DailyReadOccurrence.lesson_id == lesson)
            )
            == 4
        )
        assert (
            await c.post("/api/reader/complete", json=payload, headers=headers)
        ).status_code == 200


@pytest.mark.parametrize("text", ["…", " ", "Antes.\n\n…"])
async def test_complete_without_words_in_final_fragment(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, text: str
) -> None:
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as c:
        csrf = await register_and_onboard(c, f"empty-{uuid.uuid4()}@example.com")
        lesson = await seed_ready_lesson(c, csrf, monkeypatch, text=text)
        content = (await c.get(f"/api/lessons/{lesson}/content")).json()
        sentences = [s for p in content["paragraphs"] for s in p["sentences"]]
        r = await c.post(
            "/api/reader/complete",
            headers={"X-CSRF-Token": csrf},
            json={
                "lesson_id": str(lesson),
                "source_version": 1,
                "view_mode": "sentence",
                "last_segment_id": sentences[-1]["seg_id"] if sentences else None,
                "from_ordinal": None,
                "to_ordinal": None,
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["created_count"] == 0
        assert r.json()["summary"]["reading_days"] == 0
        listing = (await c.get("/api/lessons", params={"lang": "pt"})).json()
        card = next(row for row in listing["items"] if row["id"] == str(lesson))
        assert card["completed_at"]
        assert card["read_percent"] == 100
        assert (await c.get(f"/api/lessons/{lesson}/token-statuses")).json()["statuses"] == {}


async def test_complete_rejects_stale_version_nonfinal_range_and_foreign_lesson(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "completion-validation@example.com")
        lesson = await seed_ready_lesson(c, csrf, monkeypatch, text="Antes. Depois.")
        content = (await c.get(f"/api/lessons/{lesson}/content")).json()
        sentences = content["paragraphs"][0]["sentences"]
        payload = {
            "lesson_id": str(lesson),
            "source_version": 1,
            "view_mode": "sentence",
            "last_segment_id": sentences[-1]["seg_id"],
            "from_ordinal": 1,
            "to_ordinal": 1,
        }
        for changes, expected in [
            ({"source_version": 99}, 409),
            ({"last_segment_id": sentences[0]["seg_id"]}, 422),
            ({"to_ordinal": 0}, 422),
            ({"from_ordinal": None, "to_ordinal": None}, 422),
        ]:
            r = await c.post(
                "/api/reader/complete", headers={"X-CSRF-Token": csrf}, json={**payload, **changes}
            )
            assert r.status_code == expected
        assert (await c.get(f"/api/lessons/{lesson}")).json()["reader_position"] is None
    async with AsyncClient(transport=transport, base_url="http://test") as other:
        csrf = await register_and_onboard(other, "completion-foreign@example.com")
        r = await other.post("/api/reader/complete", json=payload, headers={"X-CSRF-Token": csrf})
        assert r.status_code in (403, 404)


async def test_completion_is_personal_and_reset_only_by_content_edit(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as owner:
        csrf = await register_and_onboard(owner, "complete-shared@example.com")
        lesson = await seed_ready_lesson(owner, csrf, monkeypatch, text="Um.", visibility="shared")
        content = (await owner.get(f"/api/lessons/{lesson}/content")).json()
        payload = {
            "lesson_id": str(lesson),
            "source_version": 1,
            "view_mode": "page",
            "last_segment_id": content["paragraphs"][0]["sentences"][0]["seg_id"],
            "from_ordinal": 0,
            "to_ordinal": 0,
        }
        headers = {"X-CSRF-Token": csrf}
        result = await owner.post("/api/reader/complete", json=payload, headers=headers)
        assert result.status_code == 200
        async with AsyncClient(transport=transport, base_url="http://test") as other:
            other_csrf = await register_and_onboard(other, "complete-shared-other@example.com")
            detail = (await other.get(f"/api/lessons/{lesson}")).json()
            assert detail["reader_position"] is None
            assert (await other.get(f"/api/lessons/{lesson}/completion-summary")).status_code == 404
            r = await other.post(
                f"/api/reader/bulk-actions/{result.json()['action_id']}/undo",
                headers={"X-CSRF-Token": other_csrf},
            )
            assert r.status_code == 404
        r = await owner.patch(
            f"/api/lessons/{lesson}", headers=headers, json={"title": "Renamed", "raw_text": "Um."}
        )
        assert r.status_code == 200
        assert (await owner.get(f"/api/lessons/{lesson}")).json()["reader_position"]["completed_at"]
        r = await owner.patch(
            f"/api/lessons/{lesson}",
            headers=headers,
            json={"title": "Changed", "raw_text": "Dois novos."},
        )
        assert r.status_code == 200
        assert (await owner.get(f"/api/lessons/{lesson}")).json()["reader_position"] is None
        r = await owner.post("/api/reader/complete", json=payload, headers=headers)
        assert r.status_code == 409
        assert r.json()["detail"] == "lesson_version_changed"


async def test_completion_failure_rolls_back_words_reading_and_position(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from flinq.modules.reader_state import completion

    real_bulk = completion.bulk_mark_known

    async def fail_after_bulk(*args: Any, **kwargs: Any) -> None:
        await real_bulk(*args, **kwargs)
        raise RuntimeError("simulated write failure")

    transport = ASGITransport(app=create_app(), raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "completion-rollback@example.com")
        lesson = await seed_ready_lesson(c, csrf, monkeypatch, text="Novo.")
        content = (await c.get(f"/api/lessons/{lesson}/content")).json()
        payload = {
            "lesson_id": str(lesson),
            "source_version": 1,
            "view_mode": "page",
            "last_segment_id": content["paragraphs"][0]["sentences"][0]["seg_id"],
            "from_ordinal": 0,
            "to_ordinal": 0,
        }
        monkeypatch.setattr(completion, "bulk_mark_known", fail_after_bulk)
        r = await c.post("/api/reader/complete", json=payload, headers={"X-CSRF-Token": csrf})
        assert r.status_code == 500
        assert (await c.get(f"/api/lessons/{lesson}")).json()["reader_position"] is None
        assert (await c.get(f"/api/lessons/{lesson}/token-statuses")).json()["statuses"] == {}
        assert (
            await db_session.scalar(
                select(func.count())
                .select_from(DailyReadOccurrence)
                .where(DailyReadOccurrence.lesson_id == lesson)
            )
            == 0
        )
        assert (
            await db_session.scalar(
                select(func.count()).select_from(BulkAction).where(BulkAction.lesson_id == lesson)
            )
            == 0
        )


async def test_completion_snapshot_counts_and_stability(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as c:
        email = "summary@example.com"
        csrf = await register_and_onboard(c, email)
        lesson = await seed_ready_lesson(c, csrf, monkeypatch, text="Novo novo sei estudo ignoro.")
        content = (await c.get(f"/api/lessons/{lesson}/content")).json()
        last = content["paragraphs"][-1]["sentences"][-1]
        async with session_scope() as s:
            user = await UserRepo(s).get_by_email(email)
            assert user
            user_id = user.id
            for term, state, source in [
                ("sei", "known", "user"),
                ("estudo", "tracked", "bulk"),
                ("ignoro", "ignored", "user"),
            ]:
                s.add(
                    TokenItem(
                        user_id=user_id,
                        language_code="pt",
                        token_text=term,
                        status=state,
                        confidence=2 if state == "tracked" else None,
                        added_by=source,
                        created_from_lesson_id=lesson if term != "ignoro" else None,
                    )
                )
            s.add(
                PhraseItem(
                    user_id=user_id,
                    language_code="pt",
                    phrase_text="novo sei",
                    display_text="Novo sei",
                    status="known",
                    created_from_lesson_id=lesson,
                )
            )
            # Two occurrences yesterday still represent only one reading day.
            for ordinal in (0, 1):
                s.add(
                    DailyReadOccurrence(
                        user_id=user_id,
                        lesson_id=lesson,
                        ordinal=ordinal,
                        date=datetime.now(UTC).date() - timedelta(days=1),
                    )
                )
        payload = {
            "lesson_id": str(lesson),
            "source_version": 1,
            "view_mode": "page",
            "last_segment_id": last["seg_id"],
            "from_ordinal": 0,
            "to_ordinal": 4,
        }
        response = await c.post(
            "/api/reader/complete", headers={"X-CSRF-Token": csrf}, json=payload
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["summary"] == {
            "total_words": 5,
            "unique_words": 4,
            "known_words": 1,
            "tracked_words": 1,
            "new_words": 1,
            "ignored_words": 1,
            "added_words": 2,
            "added_phrases": 1,
            "reading_days": 2,
            "marked_known_words": 1,
        }
        async with session_scope() as s:
            item = await s.scalar(
                select(TokenItem).where(TokenItem.user_id == user_id, TokenItem.token_text == "sei")
            )
            assert item
            item.status = "tracked"
            item.confidence = 1
        url = f"/api/lessons/{lesson}/completion-summary"
        assert (await c.get(url)).json() == result
        assert (
            await c.post("/api/reader/complete", headers={"X-CSRF-Token": csrf}, json=payload)
        ).json() == result
        async with session_scope() as s:
            exported = await export_user_data(s, user_id)
            exported_action = next(
                a for a in exported["data"]["bulk_actions"] if a["id"] == result["action_id"]
            )
            assert exported_action["payload_json"]["completion_summary"] == result["summary"]
            action = await s.get(BulkAction, uuid.UUID(result["action_id"]))
            assert action
            assert action.payload_json["completion_summary"] == result["summary"]
            # An old completed lesson has no snapshot. Never reconstruct fake history.
            action.payload_json = {
                k: v for k, v in action.payload_json.items() if k != "completion_summary"
            }
        assert (await c.get(url)).json()["summary"] is None
