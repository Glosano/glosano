"""Validated exercises and immutable answer submissions; no vocabulary side effects."""

import unicodedata
import uuid
from typing import Any

from fastapi import HTTPException
from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.chat import generations
from glosano.modules.chat.access import language
from glosano.modules.chat.models import Attempt, Exercise, Generation, Message
from glosano.modules.chat.schemas import (
    AttemptRequest,
    ExerciseDefinition,
    FreeResponse,
    Gap,
    SingleChoice,
)


def normalized(value: str, *, case_sensitive: bool = False) -> str:
    value = unicodedata.normalize("NFC", value).strip()
    return value if case_sensitive else value.casefold()


async def publish(
    s: AsyncSession, uid: uuid.UUID, cid: uuid.UUID, message_id: uuid.UUID, payload: object
) -> Exercise:
    definition = TypeAdapter[SingleChoice | Gap | FreeResponse](ExerciseDefinition).validate_python(
        payload
    )
    message = await s.scalar(
        select(Message).where(
            Message.id == message_id,
            Message.user_id == uid,
            Message.conversation_id == cid,
            Message.role == "assistant",
        )
    )
    if message is None:
        raise HTTPException(404, "message_not_found")
    public: dict[str, Any] = {}
    grading: dict[str, Any] = {}
    if isinstance(definition, SingleChoice):
        public = {"options": [o.model_dump() for o in definition.options]}
        grading = {"answer_id": definition.answer_id}
    elif isinstance(definition, Gap):
        grading = {
            "accepted_answers": definition.accepted_answers,
            "case_sensitive": definition.case_sensitive,
        }
    else:
        public = {"goal": definition.goal}
        grading = {"rubric": definition.rubric, "model_answer": definition.model_answer}
    exercise = Exercise(
        user_id=uid,
        conversation_id=cid,
        message_id=message_id,
        kind=definition.kind,
        prompt=definition.prompt,
        public_data=public,
        grading_data=grading,
    )
    s.add(exercise)
    await s.flush()
    return exercise


def exercise_output(row: Exercise) -> dict[str, Any]:
    return {
        "id": row.id,
        "conversation_id": row.conversation_id,
        "message_id": row.message_id,
        "kind": row.kind,
        "prompt": row.prompt,
        **row.public_data,
    }


def attempt_output(row: Attempt) -> dict[str, Any]:
    return {
        "id": row.id,
        "exercise_id": row.exercise_id,
        "conversation_id": row.conversation_id,
        "operation_id": row.operation_id,
        "answer": row.answer,
        "status": row.status,
        "correct": row.correct,
        "feedback": row.feedback,
        "created_at": row.created_at,
    }


async def submit(
    s: AsyncSession, uid: uuid.UUID, cid: uuid.UUID, eid: uuid.UUID, body: AttemptRequest
) -> Attempt:
    exercise = await s.scalar(
        select(Exercise).where(
            Exercise.id == eid, Exercise.user_id == uid, Exercise.conversation_id == cid
        )
    )
    if exercise is None:
        raise HTTPException(404, "exercise_not_found")
    generations.require_reply("exercise")
    previous = await s.scalar(
        select(Attempt).where(Attempt.user_id == uid, Attempt.operation_id == body.operation_id)
    )
    if previous:
        if previous.exercise_id != eid:
            raise HTTPException(409, "operation_conflict")
        return previous
    correct: bool | None = None
    if exercise.kind == "single_choice":
        options = exercise.public_data["options"]
        if body.answer not in {o["id"] for o in options}:
            raise HTTPException(422, "invalid_option")
        correct = body.answer == exercise.grading_data["answer_id"]
    elif exercise.kind == "gap":
        sensitive = bool(exercise.grading_data["case_sensitive"])
        correct = normalized(body.answer, case_sensitive=sensitive) in {
            normalized(a, case_sensitive=sensitive)
            for a in exercise.grading_data["accepted_answers"]
        }
    attempt = Attempt(
        user_id=uid,
        conversation_id=cid,
        exercise_id=eid,
        operation_id=body.operation_id,
        answer=body.answer,
        correct=correct,
        status="pending" if correct is None else "complete",
    )
    s.add(attempt)
    await s.flush()
    return attempt


async def evaluate(
    s: AsyncSession, uid: uuid.UUID, cid: uuid.UUID, aid: uuid.UUID, operation_id: uuid.UUID
) -> Generation:
    attempt = await s.scalar(
        select(Attempt).where(
            Attempt.id == aid, Attempt.user_id == uid, Attempt.conversation_id == cid
        )
    )
    if attempt is None:
        raise HTTPException(404, "attempt_not_found")
    generations.require_reply("evaluation")
    previous = await generations.replay(s, uid, operation_id)
    if previous:
        if previous.attempt_id != aid or previous.kind != "evaluation":
            raise HTTPException(409, "operation_conflict")
        return previous
    generations.require_ai()
    await generations.ensure_idle(s, cid)
    if attempt.correct is not None or attempt.status == "complete":
        raise HTTPException(409, "attempt_already_evaluated")
    lang = await language(s, uid)
    message = Message(
        user_id=uid,
        conversation_id=cid,
        role="assistant",
        state="pending",
        ui_language=lang,
        exercise_id=attempt.exercise_id,
        attempt_id=aid,
    )
    s.add(message)
    await s.flush()
    job = Generation(
        user_id=uid,
        conversation_id=cid,
        operation_id=operation_id,
        kind="evaluation",
        message_id=message.id,
        request_message_id=message.id,
        attempt_id=aid,
        ui_language=lang,
    )
    attempt.status = "pending"
    s.add(job)
    await s.flush()
    return job
