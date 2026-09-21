"""Optimistic draft revisions; stale writers receive current recovery data."""

import uuid
from typing import Any

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.chat import citations
from glosano.modules.chat.models import Attempt, Draft, Exercise
from glosano.modules.chat.schemas import DraftWrite


async def get(s: AsyncSession, uid: uuid.UUID, cid: uuid.UUID | None) -> Draft:
    row = await s.scalar(select(Draft).where(Draft.user_id == uid, Draft.conversation_id == cid))
    if row is None:
        row = Draft(user_id=uid, conversation_id=cid)
        s.add(row)
        await s.flush()
    return row


def output(row: Draft) -> dict[str, Any]:
    return {
        "revision": row.revision,
        "text": row.text,
        "citation_ids": row.citation_ids,
        "exercise_id": row.exercise_id,
        "attempt_id": row.attempt_id,
        "answers": row.answers,
    }


def check_revision(row: Draft, revision: int) -> None:
    if row.revision != revision:
        raise HTTPException(409, jsonable_encoder({"code": "draft_conflict", "draft": output(row)}))


async def check_references(
    s: AsyncSession, uid: uuid.UUID, cid: uuid.UUID | None, body: DraftWrite
) -> None:
    for ident in {*body.answers, *([body.exercise_id] if body.exercise_id else [])}:
        if (
            await s.scalar(
                select(Exercise.id).where(
                    Exercise.id == ident, Exercise.user_id == uid, Exercise.conversation_id == cid
                )
            )
            is None
        ):
            raise HTTPException(404, "exercise_not_found")
    if body.attempt_id:
        attempt = await s.scalar(
            select(Attempt).where(
                Attempt.id == body.attempt_id,
                Attempt.user_id == uid,
                Attempt.conversation_id == cid,
            )
        )
        if attempt is None or (body.exercise_id and attempt.exercise_id != body.exercise_id):
            raise HTTPException(404, "attempt_not_found")


async def write(s: AsyncSession, uid: uuid.UUID, cid: uuid.UUID | None, body: DraftWrite) -> Draft:
    row = await get(s, uid, cid)
    check_revision(row, body.revision)
    await citations.owned(s, uid, body.citation_ids)
    await check_references(s, uid, cid, body)
    row.revision += 1
    row.text = body.text
    row.citation_ids = [str(i) for i in dict.fromkeys(body.citation_ids)]
    row.exercise_id, row.attempt_id = body.exercise_id, body.attempt_id
    row.answers = {str(k): v for k, v in body.answers.items()}
    await s.flush()
    return row


def clear_sent(row: Draft, revision: int) -> None:
    check_revision(row, revision)
    row.revision += 1
    row.text, row.citation_ids = "", []
    row.exercise_id, row.attempt_id = None, None
    # Unsubmitted practice work is independent of sending a chat message.
