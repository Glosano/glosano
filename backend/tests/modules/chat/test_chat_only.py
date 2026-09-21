"""Chat-only correction: verified whole paragraphs and no practice execution."""

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import update

from glosano.core.db import session_scope
from glosano.modules.chat.models import Citation, Generation
from tests.api._reader_helpers import seed_ready_lesson
from tests.api.test_chats import draft, send
from tests.api.test_me_settings import register
from tests.modules.chat.test_generation import (
    ScriptedProvider,
    setup,  # noqa: F401  # pyright: ignore[reportUnusedImport] -- autouse fixture
)


async def test_full_paragraph_exact_repeated_selection_and_explicit_question(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    await register(client)
    text = "Olá mundo. Olá mundo. More words here.\n\nSecond paragraph remains intact."
    lid = await seed_ready_lesson(client, client.cookies["glosano_csrf"], monkeypatch, text=text)
    r = await client.post(
        "/api/chats/citations",
        json={"lesson_id": str(lid), "source_version": 1, "from_ordinal": 3, "to_ordinal": 4},
    )
    assert r.status_code == 200, r.text
    citation = r.json()
    assert citation["context_text"] == text.split("\n\n")[0]
    assert citation["context_start_offset"] == 11
    assert citation["context_end_offset"] == 20
    await draft(client, text="", citation_ids=[citation["id"]])
    r = await client.post(
        "/api/chats/send",
        json={
            "operation_id": str(uuid.uuid4()),
            "draft_revision": 1,
            "learning_language_code": "pt",
        },
    )
    assert r.status_code == 422 and r.json()["detail"] == "empty_message"
    await client.put(
        "/api/chats/drafts/new",
        json={"revision": 1, "text": "Explain this occurrence", "citation_ids": [citation["id"]]},
    )
    # A draft prepared by the old sentence-only UI is upgraded before a new send.
    async with session_scope() as s:
        legacy = await s.get(Citation, uuid.UUID(citation["id"]))
        assert legacy
        legacy.context_text = "Olá mundo."
        legacy.context_start_offset = legacy.context_end_offset = None
    sent = await send(client, revision=2)
    from glosano.modules.chat.generation import run_generation

    provider = ScriptedProvider(["An explanation."])
    await run_generation(uuid.UUID(sent["generation"]["id"]), provider=provider)
    attached = json.loads(provider.calls[0][-1]["content"])["attachments"][0]
    assert attached["context_text"] == citation["context_text"]
    assert attached["context_start_offset"] == 11
    assert attached["context_end_offset"] == 20


@pytest.mark.parametrize("kind", ["exercise", "evaluation"])
async def test_queued_practice_never_calls_provider_or_retries(client: AsyncClient, kind: str):
    await register(client)
    await draft(client)
    sent = await send(client)
    gid, cid = sent["generation"]["id"], sent["conversation_id"]
    async with session_scope() as s:
        await s.execute(update(Generation).where(Generation.id == uuid.UUID(gid)).values(kind=kind))
    from glosano.modules.chat.generation import run_generation

    provider = ScriptedProvider([])
    await run_generation(uuid.UUID(gid), provider=provider)
    assert provider.calls == []
    job = (await client.get(f"/api/chats/{cid}/generations/{gid}")).json()
    assert job["error_code"] == "practice_disabled"
    retry = await client.post(
        f"/api/chats/{cid}/generations/{gid}/retry", json={"operation_id": str(uuid.uuid4())}
    )
    assert retry.status_code == 409 and retry.json()["detail"] == "practice_disabled"


async def test_direct_practice_send_rejected(client: AsyncClient):
    await register(client)
    await draft(client)
    r = await client.post(
        "/api/chats/send",
        json={
            "operation_id": str(uuid.uuid4()),
            "draft_revision": 1,
            "learning_language_code": "pt",
            "kind": "exercise",
            "exercise_kind": "gap",
        },
    )
    assert r.status_code == 409 and r.json()["detail"] == "practice_disabled"


async def test_cross_paragraph_quote_preserves_numeric_boundaries_and_source_punctuation(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    from sqlalchemy import delete, select

    from glosano.modules.lesson_library.models import Lesson, LessonTokenOccurrence

    text = (
        "Prefix sentence. 2026 one two three four five six seven eight nine.\n\n"
        "Ten eleven twelve 2027. Final sentence."
    )
    await register(client)
    lid = await seed_ready_lesson(client, client.cookies["glosano_csrf"], monkeypatch, text=text)
    start, end = text.index("2026"), text.index("2027") + 4
    async with session_scope() as s:
        first = await s.scalar(
            select(LessonTokenOccurrence.ordinal_in_lesson).where(
                LessonTokenOccurrence.lesson_id == lid,
                LessonTokenOccurrence.start_char_offset == start,
            )
        )
        last = await s.scalar(
            select(LessonTokenOccurrence.ordinal_in_lesson).where(
                LessonTokenOccurrence.lesson_id == lid, LessonTokenOccurrence.end_char_offset == end
            )
        )
    body = {
        "lesson_id": str(lid),
        "source_version": 1,
        "from_ordinal": first,
        "to_ordinal": last,
        "context": "sentence",
    }
    r = await client.post("/api/chats/citations", json=body)
    assert r.status_code == 200, r.text
    citation = r.json()
    assert citation["selected_text"] == text[start:end]
    assert citation["context_text"] == text
    assert citation["context_start_offset"] == start and citation["context_end_offset"] == end
    await draft(client, citation_ids=[citation["id"]])
    sent = await send(client)
    async with session_scope() as s:
        await s.execute(delete(Lesson).where(Lesson.id == lid))
    history = (await client.get(f"/api/chats/{sent['conversation_id']}")).json()
    frozen = history["messages"][0]["citations"][0]
    assert frozen["context_text"] == text
    assert frozen["context_start_offset"] == start and frozen["context_end_offset"] == end
    assert frozen["source_available"] is False


async def test_oversized_full_paragraph_rejected_without_truncating_quote(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    await register(client)
    lid = await seed_ready_lesson(
        client, client.cookies["glosano_csrf"], monkeypatch, text="Hello " + "word " * 2500
    )
    response = await client.post(
        "/api/chats/citations",
        json={"lesson_id": str(lid), "source_version": 1, "from_ordinal": 0, "to_ordinal": 0},
    )
    assert response.status_code == 422 and response.json()["detail"] == "citation_too_large"


@pytest.mark.parametrize("legacy", [False, True])
async def test_export_retains_exact_citation_offsets_after_source_deletion(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, legacy: bool
):
    from sqlalchemy import delete

    from glosano.modules.lesson_library.models import Lesson

    await register(client)
    text = "Olá mundo. Olá mundo. More words here."
    lid = await seed_ready_lesson(client, client.cookies["glosano_csrf"], monkeypatch, text=text)
    response = await client.post(
        "/api/chats/citations",
        json={"lesson_id": str(lid), "source_version": 1, "from_ordinal": 3, "to_ordinal": 4},
    )
    assert response.status_code == 200, response.text
    citation = response.json()
    await draft(client, citation_ids=[citation["id"]])
    await send(client)
    async with session_scope() as s:
        if legacy:
            await s.execute(
                update(Citation)
                .where(Citation.id == uuid.UUID(citation["id"]))
                .values(context_start_offset=None, context_end_offset=None)
            )
        await s.execute(delete(Lesson).where(Lesson.id == lid))
    response = await client.get("/me/export")
    assert response.status_code == 200, response.text
    exported = next(
        c for c in response.json()["data"]["chat_citations"] if c["id"] == citation["id"]
    )
    assert exported["lesson_id"] is None
    assert exported["context_text"] == text
    assert exported["selected_text"] == citation["selected_text"]
    assert exported["context_start_offset"] == (None if legacy else 11)
    assert exported["context_end_offset"] == (None if legacy else 20)
    if not legacy:
        assert (
            text[exported["context_start_offset"] : exported["context_end_offset"]]
            == exported["selected_text"]
        )


@pytest.mark.parametrize(
    "text",
    ["```\nQuote only\n```\n\n", "````\nHas ``` in source\n````", "```\nOne\n```\n\n```\nTwo\n```"],
)
async def test_inline_quote_only_requires_question(client: AsyncClient, text: str):
    await register(client)
    await draft(client, text=text)
    response = await client.post(
        "/api/chats/send",
        json={
            "operation_id": str(uuid.uuid4()),
            "draft_revision": 1,
            "learning_language_code": "pt",
        },
    )
    assert response.status_code == 422 and response.json()["detail"] == "empty_message"


async def test_inline_edited_message_is_exact_provider_input_and_question_title(
    client: AsyncClient,
):
    await register(client)
    text = "````\nUser edited source with ``` backticks.\n````\n\nExplain this edited passage?"
    await draft(client, text=text)
    sent = await send(client)
    from glosano.modules.chat.generation import run_generation

    provider = ScriptedProvider(["An explanation."])
    await run_generation(uuid.UUID(sent["generation"]["id"]), provider=provider)
    delivered = json.loads(provider.calls[0][-1]["content"])
    assert delivered["text"] == text
    assert "attachments" not in delivered
    detail = (await client.get(f"/api/chats/{sent['conversation_id']}")).json()
    assert detail["title"] == "Explain this edited passage?"
    assert detail["messages"][0]["text"] == text
    assert detail["messages"][0]["citations"] == []


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Ordinary unfenced text", "Ordinary unfenced text"),
        ("Question first\n\n```\nQuote\n```", "Question first"),
        ("```\nOne\n```\n\n```\nTwo\n```\nQuestion", "Question"),
        ("````\n```\nsource\n```\n````\nQuestion", "Question"),
        ("```\nUnclosed quote", ""),
        ("Use `code` here", "Use `code` here"),
    ],
)
def test_question_outside_inline_quotes(text: str, expected: str):
    from glosano.modules.chat.inline_quotes import question_outside_quotes

    assert question_outside_quotes(text) == expected
