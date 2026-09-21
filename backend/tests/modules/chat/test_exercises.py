"""Practice is immutable, private, key-safe, and independent of SRS/AI availability."""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from pydantic import TypeAdapter, ValidationError

from glosano.core.config import get_settings
from glosano.core.db import session_scope
from glosano.modules.chat.models import Conversation, Exercise, Message
from glosano.modules.chat.schemas import ExerciseDefinition
from tests.api.test_me_settings import register


async def fixture_exercise(client: AsyncClient, kind: str = "gap") -> tuple[str, str]:
    uid, _ = await register(client)
    async with session_scope() as s:
        convo = Conversation(user_id=uuid.UUID(uid), title="Practice", learning_language_code="pt")
        s.add(convo)
        await s.flush()
        message = Message(
            user_id=uuid.UUID(uid), conversation_id=convo.id, role="assistant", ui_language="en"
        )
        s.add(message)
        await s.flush()
        exercise = Exercise(
            user_id=uuid.UUID(uid),
            conversation_id=convo.id,
            message_id=message.id,
            kind=kind,
            prompt="Say {{gap}}",
            public_data={} if kind == "gap" else {"goal": "Greeting"},
            grading_data={"accepted_answers": ["olá"], "case_sensitive": False}
            if kind == "gap"
            else {"rubric": "Be polite", "model_answer": "Olá"},
        )
        s.add(exercise)
        await s.flush()
        return str(convo.id), str(exercise.id)


async def fixture_attempt(eid: str, answer: str = "wrong", *, correct: bool | None = False) -> str:
    from glosano.modules.chat.models import Attempt

    async with session_scope() as s:
        exercise = await s.get(Exercise, uuid.UUID(eid))
        assert exercise
        attempt = Attempt(
            user_id=exercise.user_id,
            conversation_id=exercise.conversation_id,
            exercise_id=exercise.id,
            operation_id=uuid.uuid4(),
            answer=answer,
            correct=correct,
            status="complete" if correct is not None else "pending",
        )
        s.add(attempt)
        await s.flush()
        return str(attempt.id)


async def test_historical_attempt_reads_survive_but_new_attempts_are_disabled(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    cid, eid = await fixture_exercise(client)
    aid = await fixture_attempt(eid, "olá", correct=True)
    monkeypatch.setenv("GLOSANO_LLM_ENABLED", "false")
    get_settings.cache_clear()
    url = f"/api/chats/{cid}/exercises/{eid}/attempts"
    response = await client.post(url, json={"operation_id": str(uuid.uuid4()), "answer": "olá"})
    assert response.status_code == 409 and response.json()["detail"] == "practice_disabled"
    items = (await client.get(url)).json()["items"]
    assert items[0]["id"] == aid and items[0]["correct"] is True
    history = await client.get(f"/api/chats/{cid}")
    assert "accepted_answers" not in history.text and "grading_data" not in history.text
    get_settings.cache_clear()


async def test_historical_free_answer_is_preserved_but_evaluation_is_disabled(client: AsyncClient):
    cid, eid = await fixture_exercise(client, "free_response")
    aid = await fixture_attempt(eid, "Hello", correct=None)
    r = await client.post(
        f"/api/chats/{cid}/attempts/{aid}/evaluate", json={"operation_id": str(uuid.uuid4())}
    )
    assert r.status_code == 409 and r.json()["detail"] == "practice_disabled"
    r = await client.put(
        f"/api/chats/{cid}/draft",
        json={"revision": 0, "exercise_id": str(uuid.uuid4()), "text": "why"},
    )
    assert r.status_code == 404


@pytest.mark.parametrize(
    "payload",
    [
        {
            "kind": "single_choice",
            "prompt": "Pick",
            "options": [{"id": "a", "text": "1"}, {"id": "a", "text": "2"}],
            "answer_id": "a",
        },
        {
            "kind": "single_choice",
            "prompt": "Pick",
            "options": [{"id": "a", "text": "1"}, {"id": "b", "text": "2"}],
            "answer_id": "c",
        },
        {"kind": "gap", "prompt": "No placeholder", "accepted_answers": ["yes"]},
        {"kind": "gap", "prompt": "{{gap}} {{gap}}", "accepted_answers": ["yes"]},
        {
            "kind": "free_response",
            "prompt": "Say hi",
            "goal": "",
            "rubric": "x",
            "model_answer": "y",
        },
    ],
)
def test_invalid_exercise_cannot_be_published(payload: dict[str, Any]):
    with pytest.raises(ValidationError):
        TypeAdapter(ExerciseDefinition).validate_python(payload)


async def test_publish_validate_private_refs_and_profile_cascade(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    from sqlalchemy import delete, select

    from glosano.core.db import Base
    from glosano.modules.chat import exercises
    from glosano.modules.chat.models import Attempt
    from glosano.modules.identity.models import User

    cid, eid = await fixture_exercise(client)
    async with session_scope() as s:
        original = await s.get(Exercise, uuid.UUID(eid))
        assert original
        uid, mid = original.user_id, original.message_id
        before: dict[str, list[Any]] = {}
        for name in (
            "token_items",
            "phrase_items",
            "review_items",
            "review_events",
            "daily_user_stats",
        ):
            table = Base.metadata.tables[name]
            before[name] = list(
                (await s.execute(select(table).where(table.c.user_id == uid))).all()
            )
        with pytest.raises(ValidationError):
            await exercises.publish(
                s,
                uid,
                uuid.UUID(cid),
                mid,
                {"kind": "single_choice", "prompt": "Pick", "options": [], "answer_id": "bad"},
            )
        valid = await exercises.publish(
            s,
            uid,
            uuid.UUID(cid),
            mid,
            {
                "kind": "single_choice",
                "prompt": "Pick greeting",
                "options": [{"id": "hello", "text": "Olá"}, {"id": "bye", "text": "Adeus"}],
                "answer_id": "hello",
            },
        )
        single_id = valid.id
        second = Conversation(
            user_id=uid, title="Different conversation", learning_language_code="pt"
        )
        s.add(second)
        await s.flush()
        other_cid = str(second.id)
    wrong = await client.post(
        f"/api/chats/{other_cid}/exercises/{single_id}/attempts",
        json={"operation_id": str(uuid.uuid4()), "answer": "hello"},
    )
    assert wrong.status_code == 404
    invalid = await client.post(
        f"/api/chats/{cid}/exercises/{single_id}/attempts",
        json={"operation_id": str(uuid.uuid4()), "answer": "invented"},
    )
    assert invalid.status_code == 409
    aid = await fixture_attempt(str(single_id), "hello", correct=True)
    good_draft = await client.put(
        f"/api/chats/{cid}/draft",
        json={
            "revision": 0,
            "exercise_id": str(single_id),
            "attempt_id": aid,
            "answers": {str(single_id): "bye"},
        },
    )
    assert good_draft.status_code == 200
    stale = await client.put(f"/api/chats/{cid}/draft", json={"revision": 0, "text": "stale"})
    assert stale.status_code == 409
    assert stale.json()["detail"]["draft"]["exercise_id"] == str(single_id)
    bad_draft = await client.put(
        f"/api/chats/{other_cid}/draft", json={"revision": 0, "answers": {str(single_id): "hello"}}
    )
    assert bad_draft.status_code == 404
    exported = (await client.get("/me/export")).json()["data"]
    assert any(e["grading_data"].get("answer_id") == "hello" for e in exported["chat_exercises"])
    assert exported["chat_attempts"][0]["answer"] == "hello"
    assert exported["chat_drafts"][0]["answers"] == {str(single_id): "bye"}
    async with session_scope() as s:
        assert await s.get(Attempt, uuid.UUID(aid))
        for name, expected in before.items():
            table = Base.metadata.tables[name]
            assert (
                list((await s.execute(select(table).where(table.c.user_id == uid))).all())
                == expected
            )
        await s.execute(delete(User).where(User.id == uid))
    async with session_scope() as s:
        for name, table in Base.metadata.tables.items():
            if name.startswith("chat_"):
                assert not (await s.execute(select(table).where(table.c.user_id == uid))).first()
