"""Worker claim, publication and recovery use real PostgreSQL."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from glosano.core.config import get_settings
from glosano.core.db import session_scope
from glosano.modules.chat.models import Generation, Message
from tests.api.test_chats import draft, send
from tests.api.test_me_settings import register


@pytest.fixture(autouse=True)
def setup(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GLOSANO_LLM_ENABLED", "true")
    get_settings.cache_clear()

    async def enqueue(_gid: uuid.UUID):
        return None

    monkeypatch.setattr("glosano.worker.tasks.enqueue_chat_generation", enqueue, raising=False)
    yield
    get_settings.cache_clear()


async def test_stream_claim_cancel_retry_and_recovery(client: AsyncClient):
    from glosano.modules.chat.generation import recover_generations, run_generation

    await register(client)
    caps = (await client.get("/api/chats/capabilities")).json()
    assert caps["context_char_budget"] == 24000
    await draft(client)
    sent = await send(client)
    cid, gid = sent["conversation_id"], uuid.UUID(sent["generation"]["id"])
    started, resume = asyncio.Event(), asyncio.Event()

    class Provider:
        calls = 0

        async def stream(self, messages: list[dict[str, str]]):
            self.calls += 1
            yield "Partial"
            started.set()
            await resume.wait()
            yield " late"

    provider = Provider()
    task = asyncio.create_task(run_generation(gid, provider=provider))
    await asyncio.wait_for(started.wait(), 5)
    await run_generation(gid, provider=provider)
    assert provider.calls == 1
    history = (await client.get(f"/api/chats/{cid}")).json()
    assert history["generations"][0]["partial_text"] == "Partial"
    await client.post(f"/api/chats/{cid}/generations/{gid}/cancel")
    resume.set()
    await task
    stopped = (await client.get(f"/api/chats/{cid}/generations/{gid}")).json()
    assert stopped["status"] == "cancelled" and stopped["partial_text"] == "Partial"
    op = str(uuid.uuid4())
    r = await client.post(f"/api/chats/{cid}/generations/{gid}/retry", json={"operation_id": op})
    assert r.status_code == 200, r.text
    retry = r.json()
    assert (
        await client.post(f"/api/chats/{cid}/generations/{gid}/retry", json={"operation_id": op})
    ).json() == retry
    async with session_scope() as s:
        messages = (
            await s.scalars(select(Message).where(Message.conversation_id == uuid.UUID(cid)))
        ).all()
        assert len([m for m in messages if m.role == "user"]) == 1
        await s.execute(
            update(Generation)
            .where(Generation.id == uuid.UUID(retry["id"]))
            .values(status="running", heartbeat_at=datetime.now(UTC) - timedelta(minutes=10))
        )
    await recover_generations()
    assert (await client.get(f"/api/chats/{cid}/generations/{retry['id']}")).json()[
        "status"
    ] == "interrupted"


class ScriptedProvider:
    def __init__(self, responses: list[str | Exception]):
        self.responses = responses
        self.calls: list[list[dict[str, str]]] = []

    async def stream(self, messages: list[dict[str, str]]):
        self.calls.append(messages)
        value = self.responses.pop(0)
        if isinstance(value, Exception):
            raise value
        for i in range(0, len(value), 7):
            yield value[i : i + 7]


async def start(client: AsyncClient, **kwargs: object):
    await register(client)
    await draft(client)
    result = await send(client, revision=1, **kwargs)
    return result["conversation_id"], uuid.UUID(result["generation"]["id"])


@pytest.mark.parametrize(
    "definition",
    [
        {
            "kind": "single_choice",
            "prompt": "Which?",
            "options": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}],
            "answer_id": "a",
        },
        {
            "kind": "gap",
            "prompt": "Say {{gap}}",
            "accepted_answers": ["olá"],
            "case_sensitive": False,
        },
        {
            "kind": "free_response",
            "prompt": "Greet me",
            "goal": "Greetings",
            "rubric": "Politeness",
            "model_answer": "Olá",
        },
    ],
)
async def test_json_examples_are_text_and_cannot_publish_structured_formats(
    client: AsyncClient, definition: dict[str, object]
):
    from glosano.modules.chat.generation import run_generation
    from glosano.modules.chat.protocol import encoded

    cid, gid = await start(client)
    record = encoded({"type": "exercise", "exercise": definition}) + "\n"
    provider = ScriptedProvider([record])
    await run_generation(gid, provider=provider)
    detail = (await client.get(f"/api/chats/{cid}")).json()
    assert detail["generations"][0]["status"] == "complete"
    assert detail["messages"][-1]["exercises"] == []
    assert detail["messages"][-1]["text"] == record
    assert len(provider.calls) == 1


async def test_partial_provider_failure_and_explicit_retry(client: AsyncClient):
    from glosano.modules.chat.generation import run_generation
    from glosano.modules.chat.provider import ProviderError

    cid, gid = await start(client)

    class FailingProvider:
        calls = 0

        async def stream(self, messages: list[dict[str, str]]):
            self.calls += 1
            yield "Partial **Markdown**\n"
            raise ProviderError("provider_unavailable")

    provider = FailingProvider()
    await run_generation(gid, provider=provider)
    detail = (await client.get(f"/api/chats/{cid}")).json()
    assert detail["generations"][0]["error_code"] == "provider_unavailable"
    assert detail["messages"][-1]["text"] == "Partial **Markdown**\n"
    assert detail["messages"][-1]["exercises"] == []
    assert provider.calls == 1
    r = await client.post(
        f"/api/chats/{cid}/generations/{gid}/retry", json={"operation_id": str(uuid.uuid4())}
    )
    fresh = r.json()
    retry_provider = ScriptedProvider(["An explanation."])
    await run_generation(uuid.UUID(fresh["id"]), provider=retry_provider)
    detail = (await client.get(f"/api/chats/{cid}")).json()
    assert len(detail["messages"]) == 3
    assert detail["messages"][1]["state"] == "error"
    assert detail["messages"][1]["text"] == "Partial **Markdown**\n"
    assert detail["messages"][2]["text"] == "An explanation."
    assert detail["messages"][2]["state"] == "complete"
    assert len(retry_provider.calls) == 1


@pytest.mark.parametrize("delete_profile", [False, True])
async def test_deletion_fences_partial_and_final_publication(
    client: AsyncClient, delete_profile: bool
):
    from glosano.modules.chat.generation import run_generation

    cid, gid = await start(client)
    yielded, resume = asyncio.Event(), asyncio.Event()

    class WaitingProvider:
        async def stream(self, messages: list[dict[str, str]]):
            yield "safe partial"
            yielded.set()
            await resume.wait()
            yield (
                '{"type":"exercise","exercise":{"kind":"gap",'
                '"prompt":"{{gap}}","accepted_answers":["yes"]}}\n'
            )

    task = asyncio.create_task(run_generation(gid, provider=WaitingProvider()))
    await asyncio.wait_for(yielded.wait(), 5)
    if delete_profile:
        response = await client.request("DELETE", "/me", json={"password": "abcdefghij"})
        assert response.status_code == 200
    else:
        assert (await client.delete(f"/api/chats/{cid}")).status_code == 204
    resume.set()
    await asyncio.wait_for(task, 5)
    async with session_scope() as s:
        assert await s.get(Generation, gid) is None
        assert not list(
            (
                await s.scalars(select(Message).where(Message.conversation_id == uuid.UUID(cid)))
            ).all()
        )


async def test_worker_shutdown_and_heartbeat(client: AsyncClient):
    from glosano.modules.chat.generation import run_generation

    cid, gid = await start(client)
    entered = asyncio.Event()

    class WaitingProvider:
        async def stream(self, messages: list[dict[str, str]]):
            entered.set()
            await asyncio.Event().wait()
            yield ""

    task = asyncio.create_task(run_generation(gid, provider=WaitingProvider()))
    await asyncio.wait_for(entered.wait(), 5)
    first = (await client.get(f"/api/chats/{cid}/generations/{gid}")).json()["heartbeat_at"]
    await asyncio.sleep(1.15)
    second = (await client.get(f"/api/chats/{cid}/generations/{gid}")).json()["heartbeat_at"]
    assert second > first
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    job = (await client.get(f"/api/chats/{cid}/generations/{gid}")).json()
    assert job["status"] == "interrupted" and job["error_code"] == "worker_shutdown"


async def test_required_context_limit_prevents_provider_call(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    from glosano.modules.chat.generation import run_generation

    monkeypatch.setenv("GLOSANO_CHAT_CONTEXT_CHAR_BUDGET", "4000")
    get_settings.cache_clear()
    await register(client)
    await draft(client, text="x" * 8000)
    sent = await send(client)
    provider = ScriptedProvider([])
    await run_generation(uuid.UUID(sent["generation"]["id"]), provider=provider)
    job = (
        await client.get(
            f"/api/chats/{sent['conversation_id']}/generations/{sent['generation']['id']}"
        )
    ).json()
    assert job["error_code"] == "context_limit" and provider.calls == []


async def test_queue_failure_durable_recovery(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    from glosano.modules.chat.generation import recover_generations, run_generation
    from glosano.worker.tasks import enqueue_chat_generation

    async def failed(*args: object, **kwargs: object):
        raise RuntimeError("secret queue error")

    monkeypatch.setattr("glosano.worker.tasks.chat_generation_task.kiq", failed)
    monkeypatch.setattr("glosano.worker.tasks.enqueue_chat_generation", enqueue_chat_generation)
    cid, gid = await start(client)
    assert (await client.get(f"/api/chats/{cid}/generations/{gid}")).json()["status"] == "queued"

    async def recovered(generation_id: uuid.UUID):
        await run_generation(generation_id, provider=ScriptedProvider(["Recovered"]))

    monkeypatch.setattr("glosano.worker.tasks.enqueue_chat_generation", recovered)
    await recover_generations()
    assert (await client.get(f"/api/chats/{cid}/generations/{gid}")).json()["status"] == "complete"


async def test_recent_context_truncation_is_visible(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    from glosano.modules.chat.generation import run_generation
    from glosano.modules.chat.models import Conversation

    cid, gid = await start(client)
    async with session_scope() as s:
        convo = await s.get(Conversation, uuid.UUID(cid))
        assert convo is not None
        for i in range(5):
            s.add(
                Message(
                    user_id=convo.user_id,
                    conversation_id=convo.id,
                    role="assistant",
                    text=str(i) * 3000,
                    state="error",
                    ui_language="en",
                    created_at=datetime.now(UTC) - timedelta(minutes=10 - i),
                )
            )
    monkeypatch.setenv("GLOSANO_CHAT_CONTEXT_CHAR_BUDGET", "6000")
    get_settings.cache_clear()
    provider = ScriptedProvider(["Short answer"])
    await run_generation(gid, provider=provider)
    detail = (await client.get(f"/api/chats/{cid}")).json()
    assert detail["generations"][0]["status"] == "complete"
    assert detail["generations"][0]["context_truncated"] is True
    assert len(provider.calls[0]) == 3
    assert provider.calls[0][1] == {"role": "assistant", "content": "4" * 3000}


async def test_full_discussed_attempt_context(client: AsyncClient):
    from glosano.modules.chat.generation import run_generation
    from tests.modules.chat.test_exercises import fixture_attempt, fixture_exercise

    cid, eid = await fixture_exercise(client)
    aid = await fixture_attempt(eid)
    d = await client.put(
        f"/api/chats/{cid}/draft",
        json={
            "revision": 0,
            "text": "Explain my mistake",
            "exercise_id": eid,
            "attempt_id": aid,
        },
    )
    assert d.status_code == 200
    sent = await send(client, conversation_id=cid)
    provider = ScriptedProvider(["Try the accented greeting."])
    await run_generation(uuid.UUID(sent["generation"]["id"]), provider=provider)
    context = provider.calls[0][-1]["content"]
    assert (
        "Say {{gap}}" in context and "wrong" in context and "false" in context and "olá" in context
    )


async def test_attachment_limit_rejects_send_without_clearing_draft(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    from tests.api._reader_helpers import seed_ready_lesson

    await register(client)
    lid = await seed_ready_lesson(
        client, client.cookies["glosano_csrf"], monkeypatch, text="Olá mundo."
    )
    citation = (
        await client.post(
            "/api/chats/citations",
            json={"lesson_id": str(lid), "source_version": 1, "from_ordinal": 0, "to_ordinal": 1},
        )
    ).json()
    # IDs can be distinct copies of one source; the bound is attachment count.
    ids = [citation["id"]]
    for _ in range(4):
        c = (
            await client.post(
                "/api/chats/citations",
                json={
                    "lesson_id": str(lid),
                    "source_version": 1,
                    "from_ordinal": 0,
                    "to_ordinal": 1,
                },
            )
        ).json()
        ids.append(c["id"])
    await draft(client, citation_ids=ids)
    r = await client.post(
        "/api/chats/send",
        json={
            "operation_id": str(uuid.uuid4()),
            "draft_revision": 1,
            "learning_language_code": "pt",
        },
    )
    assert r.status_code == 422 and r.json()["detail"] == "attachment_count_limit"
    assert (await client.get("/api/chats/drafts/new")).json()["citation_ids"] == ids


async def test_retry_snapshots_current_ui_language(client: AsyncClient):
    from glosano.modules.identity.models import UserProfile

    cid, gid = await start(client)
    await client.post(f"/api/chats/{cid}/generations/{gid}/cancel")
    async with session_scope() as s:
        job = await s.get(Generation, gid)
        assert job is not None
        await s.execute(
            update(UserProfile)
            .where(UserProfile.user_id == job.user_id)
            .values(ui_language_code="ru")
        )
    retried = (
        await client.post(
            f"/api/chats/{cid}/generations/{gid}/retry", json={"operation_id": str(uuid.uuid4())}
        )
    ).json()
    assert retried["ui_language"] == "ru"
    original = (await client.get(f"/api/chats/{cid}/generations/{gid}")).json()
    assert original["ui_language"] != "ru"


async def test_worker_uses_sent_snapshot_after_source_deletion(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    from sqlalchemy import delete

    from glosano.modules.chat.generation import run_generation
    from glosano.modules.lesson_library.models import Lesson
    from tests.api._reader_helpers import seed_ready_lesson

    await register(client)
    lid = await seed_ready_lesson(
        client, client.cookies["glosano_csrf"], monkeypatch, text="Olá mundo. Outra frase."
    )
    citation = (
        await client.post(
            "/api/chats/citations",
            json={"lesson_id": str(lid), "source_version": 1, "from_ordinal": 0, "to_ordinal": 1},
        )
    ).json()
    await draft(client, citation_ids=[citation["id"]])
    sent = await send(client)
    async with session_scope() as s:
        await s.execute(delete(Lesson).where(Lesson.id == lid))
    provider = ScriptedProvider(["This is a greeting."])
    await run_generation(uuid.UUID(sent["generation"]["id"]), provider=provider)
    assert "Olá mundo" in provider.calls[0][-1]["content"]
    detail = (await client.get(f"/api/chats/{sent['conversation_id']}")).json()
    assert detail["generations"][0]["status"] == "complete"


async def test_final_text_publication_races_stop_without_deadlock(client: AsyncClient):
    from glosano.modules.chat.generation import run_generation

    cid, gid = await start(client)
    entered, resume = asyncio.Event(), asyncio.Event()

    class WaitingProvider:
        async def stream(self, messages: list[dict[str, str]]):
            entered.set()
            await resume.wait()
            yield (
                '{"type":"exercise","exercise":{"kind":"gap",'
                '"prompt":"{{gap}}","accepted_answers":["yes"]}}\n'
            )

    task = asyncio.create_task(run_generation(gid, provider=WaitingProvider()))
    await asyncio.wait_for(entered.wait(), 5)
    resume.set()
    await asyncio.wait_for(
        asyncio.gather(task, client.post(f"/api/chats/{cid}/generations/{gid}/cancel")), 5
    )
    detail = (await client.get(f"/api/chats/{cid}")).json()
    job, message = detail["generations"][0], detail["messages"][-1]
    assert job["status"] in {"complete", "cancelled"}
    assert message["exercises"] == []
    assert message["state"] == ("complete" if job["status"] == "complete" else "cancelled")


async def test_nonstream_truncation_cannot_publish_an_exercise(client: AsyncClient):
    import httpx

    from glosano.modules.chat.generation import run_generation
    from glosano.modules.chat.provider import ChatProvider

    cid, gid = await start(client)

    def endpoint(request: httpx.Request):
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"type":"exercise","exercise":{"kind":"gap",'
                                '"prompt":"{{gap}}","accepted_answers":["yes"]}}\n'
                            )
                        },
                        "finish_reason": "length",
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(endpoint)) as http:
        await run_generation(gid, provider=ChatProvider(http))
    detail = (await client.get(f"/api/chats/{cid}")).json()
    job, message = detail["generations"][0], detail["messages"][-1]
    assert job["status"] == "failed" and job["error_code"] == "provider_output_limit"
    assert message["state"] == "error" and message["text"] == ""
    assert message["exercises"] == [] and job["partial_text"] == ""


async def test_plain_markdown_stream_preserves_every_chunk_and_long_paragraph(client: AsyncClient):
    from glosano.modules.chat.generation import run_generation

    cid, gid = await start(client)
    prefix = "## Explanation\n\nPlain **Markdown** with `inline code`.\n\n```json\n"
    tail = (
        '{"type":"exercise","example":"ordinary text"}\n```\n\n' + "Long paragraph. " * 350 + "  \n"
    )
    visible, resume = asyncio.Event(), asyncio.Event()

    class PlainProvider:
        calls = 0

        async def stream(self, messages: list[dict[str, str]]):
            self.calls += 1
            yield prefix
            visible.set()
            await resume.wait()
            yield tail

    provider = PlainProvider()
    running = asyncio.create_task(run_generation(gid, provider=provider))
    await asyncio.wait_for(visible.wait(), 5)
    partial = (await client.get(f"/api/chats/{cid}/generations/{gid}")).json()
    assert partial["partial_text"] == prefix
    resume.set()
    await running
    detail = (await client.get(f"/api/chats/{cid}")).json()
    job, message = detail["generations"][0], detail["messages"][-1]
    assert job["status"] == "complete"
    assert job["partial_text"] == message["text"] == prefix + tail
    assert message["exercises"] == []
    assert provider.calls == 1


@pytest.mark.parametrize(
    ("chunks", "code", "retained"),
    [
        ([], "empty_output", ""),
        ([" ", "\n\t"], "empty_output", " \n\t"),
        (["Safe partial\n", "x" * 64000], "provider_output_limit", "Safe partial\n"),
    ],
    ids=["empty", "whitespace", "oversized"],
)
async def test_plain_output_failure_is_bounded_without_format_retry_or_publication(
    client: AsyncClient, chunks: list[str], code: str, retained: str
):
    from glosano.modules.chat.generation import run_generation
    from glosano.modules.chat.models import Attempt, Exercise

    cid, gid = await start(client)

    class ChunkProvider:
        calls = 0

        async def stream(self, messages: list[dict[str, str]]):
            self.calls += 1
            for chunk in chunks:
                yield chunk

    provider = ChunkProvider()
    await run_generation(gid, provider=provider)
    detail = (await client.get(f"/api/chats/{cid}")).json()
    job, message = detail["generations"][0], detail["messages"][-1]
    assert job["status"] == "failed" and job["error_code"] == code
    assert message["state"] == "error"
    assert job["partial_text"] == message["text"] == retained
    assert provider.calls == 1
    async with session_scope() as s:
        assert (
            await s.scalar(select(Exercise.id).where(Exercise.conversation_id == uuid.UUID(cid)))
            is None
        )
        assert (
            await s.scalar(select(Attempt.id).where(Attempt.conversation_id == uuid.UUID(cid)))
            is None
        )


async def test_plain_output_accepts_exact_64000_character_boundary(client: AsyncClient):
    from glosano.modules.chat.generation import run_generation

    cid, gid = await start(client)

    class ChunkProvider:
        async def stream(self, messages: list[dict[str, str]]):
            yield "é" * 32000
            yield "x" * 32000

    await run_generation(gid, provider=ChunkProvider())
    detail = (await client.get(f"/api/chats/{cid}")).json()
    assert detail["generations"][0]["status"] == "complete"
    assert detail["messages"][-1]["text"] == "é" * 32000 + "x" * 32000


async def test_assistant_history_is_plain_markdown_not_a_json_output_example(client: AsyncClient):
    from glosano.modules.chat.generation import run_generation
    from glosano.modules.chat.models import Conversation

    cid, gid = await start(client)
    answer = '## Previous answer\n\n```json\n{"example": true}\n```\n'
    async with session_scope() as s:
        conversation = await s.get(Conversation, uuid.UUID(cid))
        assert conversation is not None
        s.add(
            Message(
                user_id=conversation.user_id,
                conversation_id=conversation.id,
                role="assistant",
                text=answer,
                state="complete",
                ui_language="en",
                created_at=datetime.now(UTC) - timedelta(minutes=1),
            )
        )
    provider = ScriptedProvider(["Next explanation."])
    await run_generation(gid, provider=provider)
    assert provider.calls[0][1] == {"role": "assistant", "content": answer}
    prompt = provider.calls[0][0]["content"]
    assert "plain text or Markdown" in prompt
    assert "input data only" in prompt
    assert "newline-delimited" not in prompt and "4000 characters" not in prompt
    assert len(provider.calls) == 1


async def test_context_budget_counts_request_without_a_repair_reservation(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    from glosano.modules.chat.context import ContextError, build_context
    from glosano.modules.chat.protocol import encoded

    await register(client)
    await draft(client, text="Question " + "x" * 3500)
    sent = await send(client)
    async with session_scope() as s:
        job = await s.get(Generation, uuid.UUID(sent["generation"]["id"]))
        assert job is not None
        messages, _ = await build_context(s, job)
        size = len(
            encoded(
                {
                    "messages": messages,
                    "model": get_settings().llm_model,
                    "stream": True,
                    "max_tokens": get_settings().chat_answer_max_tokens,
                }
            )
        )
        monkeypatch.setenv("GLOSANO_CHAT_CONTEXT_CHAR_BUDGET", str(size))
        get_settings.cache_clear()
        assert (await build_context(s, job))[0] == messages
        monkeypatch.setenv("GLOSANO_CHAT_CONTEXT_CHAR_BUDGET", str(size - 1))
        get_settings.cache_clear()
        with pytest.raises(ContextError, match="context_limit"):
            await build_context(s, job)
