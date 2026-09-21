"""Durable generation commands. Worker I/O must happen after transaction commit."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.config import get_settings
from glosano.modules.chat.models import Attempt, Generation, Message

ACTIVE = ("queued", "running")


def require_reply(kind: str) -> None:
    if kind != "reply":
        raise HTTPException(409, "practice_disabled")


def require_ai() -> None:
    if not get_settings().llm_enabled:
        raise HTTPException(503, "ai_disabled")


async def replay(s: AsyncSession, uid: uuid.UUID, operation_id: uuid.UUID) -> Generation | None:
    return await s.scalar(
        select(Generation).where(Generation.user_id == uid, Generation.operation_id == operation_id)
    )


async def ensure_idle(s: AsyncSession, cid: uuid.UUID) -> None:
    if await s.scalar(
        select(Generation.id).where(
            Generation.conversation_id == cid, Generation.status.in_(ACTIVE)
        )
    ):
        raise HTTPException(409, "generation_active")


def output(row: Generation) -> dict[str, Any]:
    return {
        "id": row.id,
        "conversation_id": row.conversation_id,
        "operation_id": row.operation_id,
        "kind": row.kind,
        "message_id": row.message_id,
        "attempt_id": row.attempt_id,
        "status": row.status,
        "partial_text": row.partial_text,
        "heartbeat_at": row.heartbeat_at,
        "error_code": row.error_code,
        "context_truncated": row.context_truncated,
        "exercise_kind": row.exercise_kind,
        "ui_language": row.ui_language,
    }


async def cancel(s: AsyncSession, uid: uuid.UUID, cid: uuid.UUID, gid: uuid.UUID) -> Generation:
    row = await s.scalar(
        select(Generation)
        .where(Generation.id == gid, Generation.user_id == uid, Generation.conversation_id == cid)
        .with_for_update()
    )
    if row is None:
        raise HTTPException(404, "not_found")
    if row.status in ACTIVE:
        row.status = "cancelled"
        await s.execute(
            update(Message)
            .where(Message.id == row.message_id)
            .values(state="cancelled", text=row.partial_text)
        )
        if row.attempt_id:
            await s.execute(
                update(Attempt)
                .where(Attempt.id == row.attempt_id, Attempt.status == "pending")
                .values(status="failed")
            )
    await s.flush()
    return row


async def persist_partial(s: AsyncSession, gid: uuid.UUID, text: str) -> bool:
    """Conditional worker write: cancelled/deleted jobs can never be resurrected.

    Caller must hold the conversation lock when updating other domain rows in the
    same transaction. This hook itself updates only an already running generation.
    """
    if len(text) > 64000:
        raise ValueError("generation output too large")
    result = await s.execute(
        update(Generation)
        .where(Generation.id == gid, Generation.status == "running")
        .values(partial_text=text, heartbeat_at=datetime.now(UTC))
        .returning(Generation.id)
    )
    return result.scalar_one_or_none() is not None


async def retry(
    s: AsyncSession, uid: uuid.UUID, cid: uuid.UUID, gid: uuid.UUID, operation_id: uuid.UUID
) -> Generation:
    """New result identity, same immutable request; prior results remain readable."""
    original = await s.scalar(
        select(Generation).where(
            Generation.id == gid, Generation.user_id == uid, Generation.conversation_id == cid
        )
    )
    if original is None:
        raise HTTPException(404, "generation_not_found")
    require_reply(original.kind)
    previous = await replay(s, uid, operation_id)
    if previous:
        if previous.retry_of_id != gid or previous.conversation_id != cid:
            raise HTTPException(409, "operation_conflict")
        return previous
    require_ai()
    if original.status not in ("failed", "cancelled", "interrupted"):
        raise HTTPException(409, "generation_not_retryable")
    await ensure_idle(s, cid)
    if original.attempt_id:
        attempt = await s.get(Attempt, original.attempt_id)
        if attempt is None or attempt.status == "complete":
            raise HTTPException(409, "attempt_already_evaluated")
        attempt.status = "pending"
    from glosano.modules.chat.access import language

    lang = await language(s, uid)
    message = Message(
        user_id=uid,
        conversation_id=cid,
        role="assistant",
        state="pending",
        ui_language=lang,
        attempt_id=original.attempt_id,
        created_at=datetime.now(UTC),
    )
    s.add(message)
    await s.flush()
    job = Generation(
        user_id=uid,
        conversation_id=cid,
        operation_id=operation_id,
        kind=original.kind,
        message_id=message.id,
        attempt_id=original.attempt_id,
        request_message_id=original.request_message_id,
        retry_of_id=original.id,
        exercise_kind=original.exercise_kind,
        ui_language=lang,
    )
    s.add(job)
    await s.flush()
    return job


def capabilities() -> dict[str, Any]:
    settings = get_settings()
    return {
        "ai_enabled": settings.llm_enabled,
        "context_char_budget": settings.chat_context_char_budget,
        "answer_max_tokens": settings.chat_answer_max_tokens,
        "max_attachments": settings.chat_max_attachments,
        "attachment_char_limit": settings.chat_attachment_char_limit,
        "draft_text_char_limit": 16000,
    }
