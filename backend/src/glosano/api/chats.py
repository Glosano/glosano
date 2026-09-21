"""Authenticated private chat API. Commands commit before acknowledging success."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import get_session
from glosano.modules.chat import citations, drafts, exercises, generations, service
from glosano.modules.chat.access import conversation, lock_user
from glosano.modules.chat.models import Attempt, Citation, Exercise, Generation
from glosano.modules.chat.schemas import (
    AttemptRequest,
    CitationRequest,
    DraftWrite,
    EvaluationRequest,
    ParagraphCitationRequest,
    RenameRequest,
    SendRequest,
)

router = APIRouter(prefix="/api/chats", tags=["chats"])
Session = Annotated[AsyncSession, Depends(get_session)]


def user(request: Request) -> uuid.UUID:
    uid = getattr(request.state, "user_id", None)
    if uid is None:
        raise HTTPException(401)
    return uid


@router.get("")
async def list_chats(
    request: Request,
    session: Session,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    return await service.list_conversations(session, user(request), limit, offset)


@router.post("/citations")
async def prepare_citation(
    request: Request, body: CitationRequest, session: Session
) -> dict[str, Any]:
    uid = user(request)
    await lock_user(session, uid)
    row = await citations.prepare(session, uid, body)
    result = await citations.output(session, uid, row)
    await session.commit()
    return result


@router.post("/citations/paragraph")
async def prepare_paragraph_citation(
    request: Request, body: ParagraphCitationRequest, session: Session
) -> dict[str, Any]:
    uid = user(request)
    await lock_user(session, uid)
    row = await citations.prepare_paragraph(session, uid, body)
    result = await citations.output(session, uid, row)
    await session.commit()
    return result


@router.get("/drafts/new")
async def new_draft(request: Request, session: Session) -> dict[str, Any]:
    uid = user(request)
    await lock_user(session, uid)
    result = drafts.output(await drafts.get(session, uid, None))
    await session.commit()
    return result


@router.put("/drafts/new")
async def write_new_draft(request: Request, body: DraftWrite, session: Session) -> dict[str, Any]:
    uid = user(request)
    await lock_user(session, uid)
    result = drafts.output(await drafts.write(session, uid, None, body))
    await session.commit()
    return result


@router.post("/send")
async def send_message(request: Request, body: SendRequest, session: Session) -> dict[str, Any]:
    uid = user(request)
    await lock_user(session, uid)
    result = await service.send(session, uid, body)
    await session.commit()
    from glosano.worker.tasks import enqueue_chat_generation

    await enqueue_chat_generation(result["generation"]["id"])
    return result


@router.get("/capabilities")
async def chat_capabilities(request: Request) -> dict[str, Any]:
    user(request)
    return generations.capabilities()


@router.get("/{cid}")
async def read_chat(
    cid: uuid.UUID,
    request: Request,
    session: Session,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    before: datetime | None = None,
) -> dict[str, Any]:
    return await service.detail(session, user(request), cid, limit, before)


@router.patch("/{cid}")
async def rename(
    cid: uuid.UUID, request: Request, body: RenameRequest, session: Session
) -> dict[str, Any]:
    uid = user(request)
    await lock_user(session, uid)
    row = await conversation(session, uid, cid, lock=True)
    row.title = body.title
    result = service.conversation_output(row)
    await session.commit()
    return result


@router.delete("/{cid}", status_code=204)
async def delete_chat(cid: uuid.UUID, request: Request, session: Session) -> Response:
    uid = user(request)
    await lock_user(session, uid)
    await service.remove(session, uid, cid)
    await session.commit()
    return Response(status_code=204)


@router.get("/{cid}/draft")
async def get_draft(cid: uuid.UUID, request: Request, session: Session) -> dict[str, Any]:
    uid = user(request)
    await lock_user(session, uid)
    await conversation(session, uid, cid)
    result = drafts.output(await drafts.get(session, uid, cid))
    await session.commit()
    return result


@router.put("/{cid}/draft")
async def write_draft(
    cid: uuid.UUID, request: Request, body: DraftWrite, session: Session
) -> dict[str, Any]:
    uid = user(request)
    await lock_user(session, uid)
    await conversation(session, uid, cid, lock=True)
    result = drafts.output(await drafts.write(session, uid, cid, body))
    await session.commit()
    return result


@router.post("/{cid}/generations/{gid}/cancel")
async def stop(
    cid: uuid.UUID, gid: uuid.UUID, request: Request, session: Session
) -> dict[str, Any]:
    uid = user(request)
    await lock_user(session, uid)
    await conversation(session, uid, cid, lock=True)
    result = generations.output(await generations.cancel(session, uid, cid, gid))
    await session.commit()
    return result


@router.post("/{cid}/exercises/{eid}/attempts")
async def submit_attempt(
    cid: uuid.UUID, eid: uuid.UUID, request: Request, body: AttemptRequest, session: Session
) -> dict[str, Any]:
    uid = user(request)
    await lock_user(session, uid)
    await conversation(session, uid, cid, lock=True)
    result = exercises.attempt_output(await exercises.submit(session, uid, cid, eid, body))
    await session.commit()
    return result


@router.post("/{cid}/attempts/{aid}/evaluate")
async def evaluate_attempt(
    cid: uuid.UUID, aid: uuid.UUID, request: Request, body: EvaluationRequest, session: Session
) -> dict[str, Any]:
    uid = user(request)
    await lock_user(session, uid)
    await conversation(session, uid, cid, lock=True)
    result = generations.output(await exercises.evaluate(session, uid, cid, aid, body.operation_id))
    await session.commit()
    from glosano.worker.tasks import enqueue_chat_generation

    await enqueue_chat_generation(result["id"])
    return result


@router.get("/citations/{citation_id}")
async def read_citation(
    citation_id: uuid.UUID, request: Request, session: Session
) -> dict[str, Any]:
    uid = user(request)
    row = await session.scalar(
        select(Citation).where(Citation.id == citation_id, Citation.user_id == uid)
    )
    if row is None:
        raise HTTPException(404, "citation_not_found")
    return await citations.output(session, uid, row)


@router.get("/{cid}/generations/{gid}")
async def read_generation(
    cid: uuid.UUID, gid: uuid.UUID, request: Request, session: Session
) -> dict[str, Any]:
    uid = user(request)
    await conversation(session, uid, cid)
    row = await session.scalar(
        select(Generation).where(
            Generation.id == gid, Generation.conversation_id == cid, Generation.user_id == uid
        )
    )
    if row is None:
        raise HTTPException(404, "generation_not_found")
    return generations.output(row)


@router.get("/{cid}/exercises/{eid}")
async def read_exercise(
    cid: uuid.UUID, eid: uuid.UUID, request: Request, session: Session
) -> dict[str, Any]:
    uid = user(request)
    await conversation(session, uid, cid)
    row = await session.scalar(
        select(Exercise).where(
            Exercise.id == eid, Exercise.conversation_id == cid, Exercise.user_id == uid
        )
    )
    if row is None:
        raise HTTPException(404, "exercise_not_found")
    return exercises.exercise_output(row)


@router.get("/{cid}/exercises/{eid}/attempts")
async def read_attempts(
    cid: uuid.UUID,
    eid: uuid.UUID,
    request: Request,
    session: Session,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    uid = user(request)
    await read_exercise(cid, eid, request, session)
    rows = (
        await session.scalars(
            select(Attempt)
            .where(
                Attempt.user_id == uid, Attempt.conversation_id == cid, Attempt.exercise_id == eid
            )
            .order_by(Attempt.created_at.desc(), Attempt.id)
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return {"items": [exercises.attempt_output(row) for row in rows]}


@router.post("/{cid}/generations/{gid}/retry")
async def retry_generation(
    cid: uuid.UUID, gid: uuid.UUID, request: Request, body: EvaluationRequest, session: Session
) -> dict[str, Any]:
    uid = user(request)
    await lock_user(session, uid)
    await conversation(session, uid, cid, lock=True)
    result = generations.output(await generations.retry(session, uid, cid, gid, body.operation_id))
    await session.commit()
    from glosano.worker.tasks import enqueue_chat_generation

    await enqueue_chat_generation(result["id"])
    return result
