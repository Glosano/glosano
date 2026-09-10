"""GET /api/lessons/{id}/vocabulary — whole-lesson vocabulary snapshot."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.main import create_app
from flinq.modules.lesson_library.models import Lesson
from flinq.modules.lesson_library.service import process_lesson_import
from tests.api._reader_helpers import register_and_onboard, seed_ready_lesson


async def _create_item(
    client: AsyncClient,
    csrf: str,
    *,
    kind: str,
    text: str,
    status: str,
    confidence: int | None,
    lesson_id: uuid.UUID | None = None,
) -> dict[str, object]:
    response = await client.post(
        "/api/vocabulary/items",
        json={
            "kind": kind,
            "language_code": "pt",
            "text": text,
            "status": status,
            "confidence": confidence,
            "lesson_id": str(lesson_id) if lesson_id else None,
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_new_words_are_unique_across_the_whole_lesson(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com", "pt")
    lesson_id = await seed_ready_lesson(
        client, csrf, monkeypatch, text="Casa casa. Rua.", language_code="pt"
    )

    response = await client.get(f"/api/lessons/{lesson_id}/vocabulary?target=ru")

    assert response.status_code == 200
    rows = {row["text"]: row for row in response.json()["items"]}
    assert len(response.json()["items"]) == 2
    assert set(rows) == {"casa", "rua"}
    assert rows["casa"]["status"] == "new"
    assert rows["casa"]["item_id"] is None
    assert rows["casa"]["added_here"] is False
    assert rows["rua"]["context"]["sentence_text"] == "Rua."


async def test_added_here_survives_a_status_transition(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com", "pt")
    lesson_id = await seed_ready_lesson(client, csrf, monkeypatch, text="Casa.")
    created = await _create_item(
        client,
        csrf,
        kind="token",
        text="casa",
        status="tracked",
        confidence=1,
        lesson_id=lesson_id,
    )

    changed = await client.patch(
        f"/api/vocabulary/items/token/{created['item_id']}",
        json={"status": "known", "confidence": None},
        headers={"X-CSRF-Token": csrf},
    )

    assert changed.status_code == 200
    snapshot = await client.get(f"/api/lessons/{lesson_id}/vocabulary?target=ru")
    casa = next(row for row in snapshot.json()["items"] if row["text"] == "casa")
    assert casa["item_id"] == created["item_id"]
    assert casa["added_here"] is True
    assert casa["status"] == "known"
    assert casa["confidence"] is None


@pytest.mark.parametrize(
    ("kind", "text", "status", "confidence"),
    [
        ("token", "casa", "tracked", 0),
        ("token", "rua", "tracked", 5),
        ("token", "sol", "ignored", None),
        ("phrase", "casa bonita", "known", None),
    ],
)
async def test_snapshot_maps_saved_item_states(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    text: str,
    status: str,
    confidence: int | None,
) -> None:
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com", "pt")
    lesson_id = await seed_ready_lesson(client, csrf, monkeypatch, text="Casa bonita rua sol.")
    created = await _create_item(
        client,
        csrf,
        kind=kind,
        text=text,
        status="tracked",
        confidence=1,
        lesson_id=lesson_id,
    )
    if status != "tracked" or confidence != 1:
        changed = await client.patch(
            f"/api/vocabulary/items/{kind}/{created['item_id']}",
            json={"status": status, "confidence": confidence},
            headers={"X-CSRF-Token": csrf},
        )
        assert changed.status_code == 200

    snapshot = await client.get(f"/api/lessons/{lesson_id}/vocabulary?target=ru")
    row = next(
        row for row in snapshot.json()["items"] if row["kind"] == kind and row["text"] == text
    )
    assert row["item_id"] == created["item_id"]
    assert row["status"] == status
    assert row["confidence"] == confidence
    assert row["added_here"] is True


async def test_snapshot_selects_primary_translation_for_requested_target(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com", "pt")
    lesson_id = await seed_ready_lesson(client, csrf, monkeypatch, text="Casa rua sol.")
    other_lesson_id = await seed_ready_lesson(
        client,
        csrf,
        monkeypatch,
        text="Rua.",
        title="Other source",
    )
    casa = await _create_item(
        client,
        csrf,
        kind="token",
        text="casa",
        status="tracked",
        confidence=1,
        lesson_id=lesson_id,
    )
    rua = await _create_item(
        client,
        csrf,
        kind="token",
        text="rua",
        status="tracked",
        confidence=1,
        lesson_id=other_lesson_id,
    )
    sol = await _create_item(
        client,
        csrf,
        kind="token",
        text="sol",
        status="ignored",
        confidence=None,
    )
    for target, translation in (("en", "house"), ("ru", "дом")):
        response = await client.post(
            f"/api/vocabulary/items/token/{casa['item_id']}/translations",
            json={"target_language_code": target, "translation_text": translation},
            headers={"X-CSRF-Token": csrf},
        )
        assert response.status_code == 201

    snapshot = await client.get(f"/api/lessons/{lesson_id}/vocabulary?target=ru")
    rows = {(row["kind"], row["text"]): row for row in snapshot.json()["items"]}
    assert rows[("token", "casa")]["primary_translation"] == {
        "text": "дом",
        "target_language_code": "ru",
    }
    assert rows[("token", "casa")]["added_here"] is True
    assert rows[("token", "rua")]["item_id"] == rua["item_id"]
    assert rows[("token", "rua")]["added_here"] is False
    assert rows[("token", "rua")]["primary_translation"] is None
    assert rows[("token", "sol")]["item_id"] == sol["item_id"]
    assert rows[("token", "sol")]["added_here"] is False
    assert rows[("token", "sol")]["primary_translation"] is None


async def test_phrase_matches_are_same_sentence_and_user_language_scoped(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com", "pt")
    lesson_id = await seed_ready_lesson(
        client,
        csrf,
        monkeypatch,
        text="Mão, bem-estar um dois três. Outra casa.",
    )
    first = await _create_item(
        client,
        csrf,
        kind="phrase",
        text="Mão, bem-estar",
        status="known",
        confidence=None,
    )
    second = await _create_item(
        client,
        csrf,
        kind="phrase",
        text="um dois",
        status="ignored",
        confidence=None,
    )
    overlapping = await _create_item(
        client,
        csrf,
        kind="phrase",
        text="dois três",
        status="known",
        confidence=None,
    )
    await _create_item(
        client,
        csrf,
        kind="phrase",
        text="três outra",
        status="tracked",
        confidence=1,
    )
    matching = await _create_item(
        client,
        csrf,
        kind="phrase",
        text="outra casa",
        status="tracked",
        confidence=1,
    )
    # Same normalized phrase in another language must not shadow the lesson-language item.
    response = await client.post(
        "/api/vocabulary/items",
        json={
            "kind": "phrase",
            "language_code": "ru",
            "text": "outra casa",
            "status": "known",
            "confidence": None,
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 201

    snapshot = await client.get(f"/api/lessons/{lesson_id}/vocabulary?target=ru")
    phrase_rows = [row for row in snapshot.json()["items"] if row["kind"] == "phrase"]
    phrases = {row["text"]: row for row in phrase_rows}
    assert len(phrase_rows) == 4
    assert set(phrases) == {"mão bem-estar", "um dois", "dois três", "outra casa"}
    assert phrases["mão bem-estar"]["item_id"] == first["item_id"]
    assert phrases["mão bem-estar"]["display_text"] == "Mão, bem-estar"
    assert phrases["mão bem-estar"]["context"]["sentence_text"] == ("Mão, bem-estar um dois três.")
    assert phrases["um dois"]["item_id"] == second["item_id"]
    assert phrases["um dois"]["status"] == "ignored"
    assert phrases["dois três"]["item_id"] == overlapping["item_id"]
    assert phrases["um dois"]["context"]["token_ordinal"] == 3
    assert phrases["dois três"]["context"]["token_ordinal"] == 4
    assert phrases["outra casa"]["item_id"] == matching["item_id"]
    assert "três outra" not in phrases


async def test_bulk_known_is_saved_without_added_here(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com", "pt")
    lesson_id = await seed_ready_lesson(client, csrf, monkeypatch, text="Casa.")

    response = await client.post(
        "/api/reader/bulk-known",
        json={"lesson_id": str(lesson_id), "from_ordinal": 0, "to_ordinal": 10},
        headers={"X-CSRF-Token": csrf},
    )

    assert response.status_code == 200
    snapshot = await client.get(f"/api/lessons/{lesson_id}/vocabulary?target=ru")
    assert snapshot.json()["items"] == [
        {
            "kind": "token",
            "item_id": snapshot.json()["items"][0]["item_id"],
            "text": "casa",
            "display_text": "Casa",
            "status": "known",
            "confidence": None,
            "primary_translation": None,
            "added_here": False,
            "context": snapshot.json()["items"][0]["context"],
        }
    ]


async def test_provenance_item_remains_after_its_context_disappears(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com", "pt")
    lesson_id = await seed_ready_lesson(client, csrf, monkeypatch, text="Casa bonita.")
    created = await _create_item(
        client,
        csrf,
        kind="token",
        text="casa",
        status="tracked",
        confidence=1,
        lesson_id=lesson_id,
    )
    phrase = await _create_item(
        client,
        csrf,
        kind="phrase",
        text="casa bonita",
        status="tracked",
        confidence=2,
        lesson_id=lesson_id,
    )
    lesson = await db_session.get(Lesson, lesson_id)
    assert lesson is not None
    lesson.raw_text = "Rua."
    lesson.status = "processing"
    await process_lesson_import(db_session, lesson_id)
    await db_session.commit()

    snapshot = await client.get(f"/api/lessons/{lesson_id}/vocabulary?target=ru")

    rows = {(row["kind"], row["text"]): row for row in snapshot.json()["items"]}
    assert rows[("token", "casa")]["item_id"] == created["item_id"]
    assert rows[("token", "casa")]["added_here"] is True
    assert rows[("token", "casa")]["context"] is None
    assert rows[("token", "rua")]["status"] == "new"
    assert rows[("phrase", "casa bonita")]["item_id"] == phrase["item_id"]
    assert rows[("phrase", "casa bonita")]["added_here"] is True
    assert rows[("phrase", "casa bonita")]["context"] is None


async def test_vocabulary_requires_authentication() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as anonymous:
        response = await anonymous.get(f"/api/lessons/{uuid.uuid4()}/vocabulary?target=ru")
    assert response.status_code == 401


async def test_vocabulary_validates_target(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com", "pt")
    lesson_id = await seed_ready_lesson(client, csrf, monkeypatch, text="Casa.")
    response = await client.get(f"/api/lessons/{lesson_id}/vocabulary?target=xx")
    assert response.status_code == 422


async def test_vocabulary_missing_and_processing_lesson_access(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = await register_and_onboard(client, f"{uuid.uuid4()}@example.com", "pt")
    missing = await client.get(f"/api/lessons/{uuid.uuid4()}/vocabulary?target=ru")
    assert missing.status_code == 404

    async def noop(_lesson_id: object, _job_id: object) -> None:
        return None

    monkeypatch.setattr("flinq.api.lessons.enqueue_lesson_import", noop)
    created = await client.post(
        "/api/lessons",
        json={
            "title": "Processing",
            "language_code": "pt",
            "raw_text": "Casa.",
            "visibility": "private",
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert created.status_code == 202
    processing = await client.get(f"/api/lessons/{created.json()['id']}/vocabulary?target=ru")
    assert processing.status_code == 409
    assert processing.json() == {"detail": "lesson_not_ready"}


async def test_foreign_private_vocabulary_is_forbidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as owner:
        owner_csrf = await register_and_onboard(owner, f"{uuid.uuid4()}@example.com", "pt")
        lesson_id = await seed_ready_lesson(
            owner,
            owner_csrf,
            monkeypatch,
            text="Casa.",
            visibility="private",
        )
    async with AsyncClient(transport=transport, base_url="http://test") as other:
        await register_and_onboard(other, f"{uuid.uuid4()}@example.com", "pt")
        response = await other.get(f"/api/lessons/{lesson_id}/vocabulary?target=ru")
    assert response.status_code == 403


async def test_shared_lesson_uses_current_users_vocabulary_and_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as owner:
        owner_csrf = await register_and_onboard(owner, f"{uuid.uuid4()}@example.com", "pt")
        lesson_id = await seed_ready_lesson(
            owner,
            owner_csrf,
            monkeypatch,
            text="Casa bonita.",
            visibility="shared",
        )
        owner_item = await _create_item(
            owner,
            owner_csrf,
            kind="token",
            text="casa",
            status="tracked",
            confidence=5,
            lesson_id=lesson_id,
        )
        owner_translation = await owner.post(
            f"/api/vocabulary/items/token/{owner_item['item_id']}/translations",
            json={"target_language_code": "ru", "translation_text": "дом владельца"},
            headers={"X-CSRF-Token": owner_csrf},
        )
        assert owner_translation.status_code == 201
        await _create_item(
            owner,
            owner_csrf,
            kind="phrase",
            text="casa bonita",
            status="known",
            confidence=None,
        )

    async with AsyncClient(transport=transport, base_url="http://test") as learner:
        learner_csrf = await register_and_onboard(learner, f"{uuid.uuid4()}@example.com", "pt")
        before = await learner.get(f"/api/lessons/{lesson_id}/vocabulary?target=ru")
        casa_before = next(row for row in before.json()["items"] if row["text"] == "casa")
        assert casa_before["status"] == "new"
        assert casa_before["item_id"] is None
        assert casa_before["primary_translation"] is None
        assert all(row["kind"] != "phrase" for row in before.json()["items"])

        created = await _create_item(
            learner,
            learner_csrf,
            kind="token",
            text="casa",
            status="tracked",
            confidence=1,
            lesson_id=lesson_id,
        )
        changed = await learner.patch(
            f"/api/vocabulary/items/token/{created['item_id']}",
            json={
                "status": "known",
                "confidence": None,
                "lesson_id": str(lesson_id),
            },
            headers={"X-CSRF-Token": learner_csrf},
        )
        assert changed.status_code == 200
        after = await learner.get(f"/api/lessons/{lesson_id}/vocabulary?target=ru")

    casa_after = next(row for row in after.json()["items"] if row["text"] == "casa")
    assert casa_after["item_id"] == created["item_id"]
    assert casa_after["status"] == "known"
    assert casa_after["added_here"] is True
