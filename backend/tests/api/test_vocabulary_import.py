"""LingQ CSV import endpoint and import job status API (FLQ-14.1)."""

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator, Callable, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select

from glosano.core.db import session_scope
from glosano.core.lesson_upload import MAX_LESSON_FILE_BYTES
from glosano.modules.identity.export import export_user_data
from glosano.modules.lingq_import import jobs
from glosano.modules.lingq_import import lingq_client as client_mod
from glosano.modules.lingq_import.lingq_client import LingqClient
from glosano.modules.lingq_import.models import VocabularyImportJob
from glosano.modules.lingq_import.records import MAX_REPORT_ISSUES, LingqCard
from glosano.modules.review.models import ReviewItem
from tests.api.test_me_native_language import clear_native, onboard, register

SAMPLE = Path(__file__).parents[1] / "fixtures" / "lingq" / "sample.csv"
URL = "/api/vocabulary/import"


async def _learner(client: AsyncClient) -> uuid.UUID:
    user_id = await register(client)
    assert await onboard(client, learning_languages=["pt"], native_language="ru") == 200
    return user_id


async def _post_csv(client: AsyncClient, content: bytes, **data: str) -> Response:
    return await client.post(
        f"{URL}/csv",
        data={"lang": "pt", **data},
        files={"file": ("vocabulary.csv", content, "text/csv")},
    )


@pytest.fixture
async def blocked(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[asyncio.Event]:
    """Hold every import inside `import_cards` until the yielded event is set."""
    release = asyncio.Event()

    async def import_cards(cards: Sequence[LingqCard], **_kwargs: Any) -> None:
        await release.wait()

    monkeypatch.setattr("glosano.modules.lingq_import.core.import_cards", import_cards)
    yield release
    release.set()  # never leave a job running past a failed test
    await jobs.drain()


async def test_csv_import_end_to_end(client: AsyncClient) -> None:
    await _learner(client)

    response = await _post_csv(client, SAMPLE.read_bytes())
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "running"
    assert body["source"] == "csv"
    assert body["language_code"] == "pt"
    assert body["total"] == 10
    await jobs.drain()

    job = (await client.get(f"{URL}/{body['id']}")).json()
    assert job["status"] == "done"
    assert job["error_code"] is None
    assert job["finished_at"] is not None
    assert job["total"] == 10
    assert job["processed"] == 10
    assert job["created_tokens"] == 8
    assert job["created_phrases"] == 1
    assert job["updated_items"] == 0
    assert job["known_words"] == 0
    assert job["skipped"] == 1
    assert job["issues"] == [{"row": 11, "term": None, "code": "empty_term"}]
    assert job["issues_dropped"] == 0

    listing = (await client.get("/api/vocabulary", params={"lang": "pt", "page_size": 25})).json()
    texts = {item["text"]: item for item in listing["items"]}
    assert listing["total"] == 9
    assert {"abacaxi", "livro", "por causa de"} <= texts.keys()
    assert texts["abacaxi"]["status"] == "tracked"
    assert texts["abacaxi"]["confidence"] == 1
    assert texts["abacaxi"]["primary_translation"]["text"] == "ананас"


async def test_csv_import_reports_dropped_issues(client: AsyncClient) -> None:
    await _learner(client)
    rows = MAX_REPORT_ISSUES + 5

    response = await _post_csv(client, b"term,phrase\n" + b",x\n" * rows)
    assert response.status_code == 202, response.text
    assert response.json()["issues_dropped"] == 0
    await jobs.drain()

    job = (await client.get(f"{URL}/{response.json()['id']}")).json()
    assert job["status"] == "done"
    assert (job["processed"], job["skipped"]) == (rows, rows)
    assert len(job["issues"]) == MAX_REPORT_ISSUES
    assert job["issues_dropped"] == 5


async def test_csv_import_as_known(client: AsyncClient) -> None:
    await _learner(client)

    response = await _post_csv(client, SAMPLE.read_bytes(), status="known", confidence="3")
    assert response.status_code == 202, response.text
    await jobs.drain()

    job = (await client.get(f"{URL}/{response.json()['id']}")).json()
    assert job["status"] == "done"
    assert job["known_words"] == 8
    listing = (await client.get("/api/vocabulary", params={"lang": "pt"})).json()
    assert {item["status"] for item in listing["items"]} == {"known"}
    assert {item["confidence"] for item in listing["items"]} == {None}


@pytest.mark.parametrize("confidence", ["6", "-1"])
async def test_csv_rejects_invalid_confidence(client: AsyncClient, confidence: str) -> None:
    await _learner(client)

    response = await _post_csv(client, SAMPLE.read_bytes(), confidence=confidence)

    assert response.status_code == 422
    assert response.json()["detail"] == "invalid_confidence"


async def test_csv_rejects_non_utf8(client: AsyncClient) -> None:
    await _learner(client)

    response = await _post_csv(client, "term\ncasã\n".encode("latin-1"))

    assert response.status_code == 422
    assert response.json()["detail"] == "csv_not_utf8"


@pytest.mark.parametrize(
    ("content", "code"),
    [
        (b"phrase\nA casa.\n", "csv_missing_term_column"),
        (b"term,phrase\ncasa," + b"a" * 200_000 + b"\n", "csv_malformed"),
    ],
)
async def test_csv_format_errors(client: AsyncClient, content: bytes, code: str) -> None:
    await _learner(client)

    response = await _post_csv(client, content)

    assert response.status_code == 422
    assert response.json()["detail"] == code


async def test_csv_too_large(client: AsyncClient) -> None:
    await _learner(client)

    response = await _post_csv(client, b"term\n" + b"a" * MAX_LESSON_FILE_BYTES)

    assert response.status_code == 413
    assert response.json()["detail"] == "csv_too_large"


async def test_csv_request_over_upload_limit(client: AsyncClient) -> None:
    await _learner(client)

    response = await _post_csv(client, b"term\n" + b"a" * (MAX_LESSON_FILE_BYTES + 128 * 1024))

    assert response.status_code == 413
    assert response.json()["detail"] == "csv_too_large"


async def test_csv_requires_native_language(client: AsyncClient) -> None:
    user_id = await _learner(client)
    await clear_native(user_id)

    response = await _post_csv(client, SAMPLE.read_bytes())

    assert response.status_code == 409
    assert response.json()["detail"] == "native_language_required"


async def test_csv_requires_login(client: AsyncClient) -> None:
    response = await _post_csv(client, SAMPLE.read_bytes())

    assert response.status_code == 403  # no session, so no CSRF token either
    assert (await client.get(f"{URL}/active", params={"lang": "pt"})).status_code == 401
    assert (await client.get(f"{URL}/{uuid.uuid4()}")).status_code == 401


async def test_second_import_while_running_conflicts(
    client: AsyncClient, blocked: asyncio.Event
) -> None:
    await _learner(client)
    first = await _post_csv(client, SAMPLE.read_bytes())
    assert first.status_code == 202, first.text

    second = await _post_csv(client, SAMPLE.read_bytes())

    assert second.status_code == 409
    assert second.json()["detail"] == "import_already_running"
    blocked.set()
    await jobs.drain()
    job = (await client.get(f"{URL}/{first.json()['id']}")).json()
    assert job["status"] == "done"


async def test_job_of_other_user_is_404(client: AsyncClient) -> None:
    await _learner(client)
    response = await _post_csv(client, SAMPLE.read_bytes())
    await jobs.drain()
    job_id = response.json()["id"]
    assert (await client.get(f"{URL}/{job_id}")).status_code == 200

    await _learner(client)  # a second user takes over the client's session

    response = await client.get(f"{URL}/{job_id}")
    assert response.status_code == 404
    assert response.json()["detail"] == "import_not_found"
    assert (await client.get(f"{URL}/{uuid.uuid4()}")).status_code == 404


async def test_active_returns_running_job(client: AsyncClient, blocked: asyncio.Event) -> None:
    await _learner(client)
    assert (await client.get(f"{URL}/active", params={"lang": "pt"})).json() is None
    started = await _post_csv(client, SAMPLE.read_bytes())
    job_id = started.json()["id"]

    active = (await client.get(f"{URL}/active", params={"lang": "pt"})).json()
    assert active["id"] == job_id
    assert active["status"] == "running"
    assert (await client.get(f"{URL}/active", params={"lang": "es"})).json() is None

    blocked.set()
    await jobs.drain()
    active = (await client.get(f"{URL}/active", params={"lang": "pt"})).json()
    assert active["id"] == job_id
    assert active["status"] == "done"

    async with session_scope() as s:
        row = await s.get(VocabularyImportJob, uuid.UUID(job_id))
        assert row is not None
        row.finished_at = datetime.now(UTC) - timedelta(minutes=11)
    assert (await client.get(f"{URL}/active", params={"lang": "pt"})).json() is None


# --- LingQ import by API token (FLQ-14.2) ---

TOKEN = "tok-secret-42"
LINGQ_PAST_DUE = "2024-02-09T09:41:15.849817"
LINGQ_FUTURE_DUE = "2030-01-01T00:00:00"


def _lingq_card(term: str, status: int, **fields: object) -> dict[str, object]:
    return {"pk": len(term), "term": term, "status": status, **fields}


LINGQ_PAGES: list[list[dict[str, object]]] = [
    [
        _lingq_card(
            "casa",
            0,
            extended_status=None,
            fragment="A casa é grande…",
            hints=[{"locale": "ru", "text": "дом"}],
            tags=["noun"],
            srs_due_date=LINGQ_PAST_DUE,
        ),
        _lingq_card(
            "livro", 2, hints=[{"locale": "ru", "text": "книга"}], srs_due_date=LINGQ_FUTURE_DUE
        ),
    ],
    [
        _lingq_card("obrigado", 3, extended_status=3),
        _lingq_card("por causa de", 1, hints=[{"locale": "ru", "text": "из-за"}]),
    ],
]


def _lingq_handler(
    pages: list[list[dict[str, object]]], seen: list[httpx.Request]
) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        page = int(request.url.params["page"])
        more = page < len(pages)
        return httpx.Response(
            200,
            json={
                "count": sum(len(p) for p in pages),
                "next": f"https://lingq.test/next?page={page + 1}" if more else None,
                "previous": None,
                "results": pages[page - 1],
            },
        )

    return handler


def _mock_lingq(
    monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]
) -> list[str]:
    """Route the job's LingQ client through `handler`; returns the tokens it was built with."""
    tokens: list[str] = []

    def factory(token: str) -> LingqClient:
        tokens.append(token)
        return LingqClient(
            token,
            base_url="https://lingq.test",
            timeout=5.0,
            page_delay=0.0,
            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )

    monkeypatch.setattr(jobs, "lingq_client_factory", factory)
    return tokens


async def _post_lingq(client: AsyncClient, **body: object) -> Response:
    payload: dict[str, object] = {
        "lang": "pt",
        "token": TOKEN,
        "conflict_mode": "keep",
        "import_tags": True,
    }
    return await client.post(f"{URL}/lingq", json=payload | body)


async def _items(client: AsyncClient) -> dict[str, dict[str, Any]]:
    listing = (await client.get("/api/vocabulary", params={"lang": "pt", "page_size": 25})).json()
    return {item["text"]: item for item in listing["items"]}


async def _due_at(item_id: str) -> datetime:
    async with session_scope() as s:
        review = await s.scalar(
            select(ReviewItem).where(
                ReviewItem.item_id == uuid.UUID(item_id), ReviewItem.is_active.is_(True)
            )
        )
        assert review is not None
        return review.due_at


async def test_lingq_import_end_to_end(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _learner(client)
    seen: list[httpx.Request] = []
    tokens = _mock_lingq(monkeypatch, _lingq_handler(LINGQ_PAGES, seen))

    response = await _post_lingq(client)
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "running"
    assert body["source"] == "lingq"
    assert body["language_code"] == "pt"
    await jobs.drain()

    assert tokens == [TOKEN]
    assert [r.url.params["page"] for r in seen] == ["1", "2"]
    assert seen[0].url.path == "/api/v3/pt/cards/"
    assert seen[0].headers["Authorization"] == f"Token {TOKEN}"

    job = (await client.get(f"{URL}/{body['id']}")).json()
    assert job["status"] == "done", job
    assert job["error_code"] is None
    assert job["total"] == 4
    assert job["processed"] == 4
    assert job["created_tokens"] == 3
    assert job["created_phrases"] == 1
    assert job["known_words"] == 1
    assert job["skipped"] == 0

    items = await _items(client)
    assert {k: (v["status"], v["confidence"]) for k, v in items.items()} == {
        "casa": ("tracked", 1),
        "livro": ("tracked", 3),
        "obrigado": ("known", None),
        "por causa de": ("tracked", 2),
    }
    assert items["casa"]["primary_translation"]["text"] == "дом"
    assert items["casa"]["tags"] == ["noun"]
    assert await _due_at(items["casa"]["item_id"]) == datetime(
        2024, 2, 9, 9, 41, 15, 849817, tzinfo=UTC
    )
    assert await _due_at(items["livro"]["item_id"]) == datetime(2030, 1, 1, tzinfo=UTC)

    async with session_scope() as s:
        row = await s.get(VocabularyImportJob, uuid.UUID(body["id"]))
        assert row is not None
        assert row.source == "lingq"
        assert row.conflict_mode == "keep"
        assert row.meta_json == {
            "card_keys": [
                "extended_status",
                "fragment",
                "hints",
                "pk",
                "srs_due_date",
                "status",
                "tags",
                "term",
            ],
            "status_values": {"0/none": 1, "2/none": 1, "3/3": 1, "1/none": 1},
        }


async def test_lingq_unauthorized_marks_failed(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _learner(client)
    _mock_lingq(monkeypatch, lambda _request: httpx.Response(401, json={"detail": "nope"}))

    response = await _post_lingq(client)
    assert response.status_code == 202, response.text
    await jobs.drain()

    job = (await client.get(f"{URL}/{response.json()['id']}")).json()
    assert job["status"] == "failed"
    assert job["error_code"] == "lingq_unauthorized"
    assert job["finished_at"] is not None
    assert await _items(client) == {}


@pytest.mark.parametrize(
    ("page_two_status", "error_code"),
    [(401, "lingq_unauthorized"), (500, "lingq_unavailable")],
)
async def test_lingq_failure_on_later_page_keeps_earlier_progress(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, page_two_status: int, error_code: str
) -> None:
    await _learner(client)
    monkeypatch.setattr(client_mod, "_BACKOFF_BASE_SECONDS", 0.0)
    page_one = _lingq_handler(LINGQ_PAGES, [])
    pages_seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        pages_seen.append(request.url.params["page"])
        if request.url.params["page"] == "1":
            return page_one(request)
        return httpx.Response(page_two_status, json={"detail": "nope"})  # every attempt

    _mock_lingq(monkeypatch, handler)

    response = await _post_lingq(client)
    assert response.status_code == 202, response.text
    await jobs.drain()

    retries = ["2"] if page_two_status == 401 else ["2", "2", "2"]
    assert pages_seen == ["1", *retries]
    job = (await client.get(f"{URL}/{response.json()['id']}")).json()
    assert job["status"] == "failed"
    assert job["error_code"] == error_code
    assert job["finished_at"] is not None
    assert (job["total"], job["processed"], job["created_tokens"]) == (4, 2, 2)
    async with session_scope() as s:
        row = await s.get(VocabularyImportJob, uuid.UUID(response.json()["id"]))
        assert row is not None
        assert row.meta_json == {
            "card_keys": [
                "extended_status",
                "fragment",
                "hints",
                "pk",
                "srs_due_date",
                "status",
                "tags",
                "term",
            ],
            "status_values": {"0/none": 1, "2/none": 1},
        }
    items = await _items(client)
    assert {k: (v["status"], v["confidence"]) for k, v in items.items()} == {
        "casa": ("tracked", 1),
        "livro": ("tracked", 3),
    }
    assert items["casa"]["primary_translation"]["text"] == "дом"


async def test_token_never_persisted(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    from loguru import logger

    user_id = await _learner(client)
    sink_id = logger.add(lambda m: logging.getLogger("loguru").warning(m), level="DEBUG")
    try:
        with caplog.at_level(logging.DEBUG):
            # A failing run (LingQ echoes the token back) and a successful one.
            _mock_lingq(monkeypatch, lambda _request: httpx.Response(500, text=f"bad {TOKEN}"))
            monkeypatch.setattr(client_mod, "_BACKOFF_BASE_SECONDS", 0.0)
            failed = await _post_lingq(client)
            assert failed.status_code == 202, failed.text
            await jobs.drain()
            _mock_lingq(monkeypatch, _lingq_handler(LINGQ_PAGES, []))
            done = await _post_lingq(client, conflict_mode="update")
            assert done.status_code == 202, done.text
            await jobs.drain()
    finally:
        logger.remove(sink_id)

    texts = [failed.text, done.text, caplog.text]
    for job_id in (failed.json()["id"], done.json()["id"]):
        texts.append((await client.get(f"{URL}/{job_id}")).text)
    texts.append((await client.get(f"{URL}/active", params={"lang": "pt"})).text)
    async with session_scope() as s:
        rows = (await s.execute(select(VocabularyImportJob))).scalars().all()
        assert {row.status for row in rows} == {"failed", "done"}
        texts.extend(
            json.dumps({c.key: getattr(row, c.key) for c in row.__table__.columns}, default=str)
            for row in rows
        )
        texts.append(json.dumps(await export_user_data(s, user_id), default=str))
    assert "lingq_unavailable" in texts[-1]  # the export does include the jobs
    for text in texts:
        assert TOKEN not in text


async def test_lingq_update_mode_downgrades_existing(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _learner(client)
    created = await client.post(
        "/api/vocabulary/items",
        json={"kind": "token", "language_code": "pt", "text": "casa", "status": "known"},
    )
    assert created.status_code == 201, created.text
    _mock_lingq(monkeypatch, _lingq_handler(LINGQ_PAGES, []))

    response = await _post_lingq(client, conflict_mode="update")
    assert response.status_code == 202, response.text
    await jobs.drain()

    job = (await client.get(f"{URL}/{response.json()['id']}")).json()
    assert job["status"] == "done", job
    assert job["created_tokens"] == 2
    assert job["updated_items"] == 1
    items = await _items(client)
    assert (items["casa"]["status"], items["casa"]["confidence"]) == ("tracked", 1)
    assert await _due_at(items["casa"]["item_id"]) == datetime(
        2024, 2, 9, 9, 41, 15, 849817, tzinfo=UTC
    )
    async with session_scope() as s:
        row = await s.get(VocabularyImportJob, uuid.UUID(response.json()["id"]))
        assert row is not None
        assert row.conflict_mode == "update"


async def test_lingq_keep_mode_preserves_existing_level(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _learner(client)
    created = await client.post(
        "/api/vocabulary/items",
        json={"kind": "token", "language_code": "pt", "text": "casa", "status": "known"},
    )
    assert created.status_code == 201, created.text
    _mock_lingq(monkeypatch, _lingq_handler(LINGQ_PAGES, []))

    response = await _post_lingq(client, conflict_mode="keep")
    await jobs.drain()

    job = (await client.get(f"{URL}/{response.json()['id']}")).json()
    assert job["status"] == "done", job
    items = await _items(client)
    assert (items["casa"]["status"], items["casa"]["confidence"]) == ("known", None)
    assert items["casa"]["primary_translation"]["text"] == "дом"


@pytest.mark.parametrize("token", ["", "   "])
async def test_request_validation_rejects_empty_token(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, token: str
) -> None:
    await _learner(client)
    tokens = _mock_lingq(monkeypatch, _lingq_handler(LINGQ_PAGES, []))

    response = await _post_lingq(client, token=token)

    assert response.status_code == 422
    assert tokens == []
    assert (await client.get(f"{URL}/active", params={"lang": "pt"})).json() is None


@pytest.mark.parametrize(
    "body",
    [
        {"token": TOKEN * 20},  # too long
        {"token": f"{TOKEN}\nX-Evil: 1"},  # not a header-safe token
        {"lang": "xx"},
        {"lang": None},
        {"lang": ...},  # missing: the error's input is the whole body
        {"conflict_mode": "merge"},
    ],
)
async def test_request_validation_never_echoes_token(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, body: dict[str, object]
) -> None:
    await _learner(client)
    tokens = _mock_lingq(monkeypatch, _lingq_handler(LINGQ_PAGES, []))

    payload = {"lang": "pt", "token": TOKEN, "conflict_mode": "keep", "import_tags": True}
    payload = {k: v for k, v in (payload | body).items() if v is not ...}

    response = await client.post(f"{URL}/lingq", json=payload)

    assert response.status_code == 422
    assert TOKEN not in response.text
    assert tokens == []


async def test_lingq_requires_native_language(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user_id = await _learner(client)
    await clear_native(user_id)
    tokens = _mock_lingq(monkeypatch, _lingq_handler(LINGQ_PAGES, []))

    response = await _post_lingq(client)

    assert response.status_code == 409
    assert response.json()["detail"] == "native_language_required"
    assert tokens == []
