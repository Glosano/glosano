"""Conversation lifecycle and atomic draft-to-message commands."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.config import get_settings
from glosano.modules.chat import citations, drafts, generations
from glosano.modules.chat.access import conversation, language
from glosano.modules.chat.inline_quotes import question_outside_quotes
from glosano.modules.chat.models import (
    Attempt,
    Citation,
    Conversation,
    Exercise,
    Generation,
    Message,
)
from glosano.modules.chat.schemas import SendRequest


def conversation_output(row: Conversation) -> dict[str, Any]:
    return {
        "id": row.id,
        "title": row.title,
        "learning_language_code": row.learning_language_code,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


async def list_conversations(
    s: AsyncSession, uid: uuid.UUID, limit: int, offset: int
) -> dict[str, Any]:
    rows = (
        await s.scalars(
            select(Conversation)
            .where(Conversation.user_id == uid)
            .order_by(Conversation.updated_at.desc(), Conversation.id)
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return {"items": [conversation_output(row) for row in rows]}


async def detail(
    s: AsyncSession,
    uid: uuid.UUID,
    cid: uuid.UUID,
    limit: int = 100,
    before: datetime | None = None,
) -> dict[str, Any]:
    from glosano.modules.chat.exercises import attempt_output, exercise_output

    row = await conversation(s, uid, cid)
    query = select(Message).where(Message.conversation_id == cid, Message.user_id == uid)
    if before:
        query = query.where(Message.created_at < before)
    messages = list(
        (
            await s.scalars(
                query.order_by(Message.created_at.desc(), Message.id.desc()).limit(limit)
            )
        ).all()
    )
    messages.reverse()
    result: list[dict[str, Any]] = []
    for message in messages:
        attached = (
            await s.scalars(
                select(Citation).where(Citation.message_id == message.id, Citation.user_id == uid)
            )
        ).all()
        exercises = (
            await s.scalars(
                select(Exercise).where(Exercise.message_id == message.id, Exercise.user_id == uid)
            )
        ).all()
        result.append(
            {
                "id": message.id,
                "role": message.role,
                "text": message.text,
                "state": message.state,
                "ui_language": message.ui_language,
                "created_at": message.created_at,
                "exercise_id": message.exercise_id,
                "attempt_id": message.attempt_id,
                "citations": [await citations.output(s, uid, c) for c in attached],
                "exercises": [exercise_output(e) for e in exercises],
            }
        )
    attempts = (
        await s.scalars(
            select(Attempt)
            .where(Attempt.user_id == uid, Attempt.conversation_id == cid)
            .order_by(Attempt.created_at.desc())
            .limit(100)
        )
    ).all()
    jobs = (
        await s.scalars(
            select(Generation)
            .where(Generation.user_id == uid, Generation.conversation_id == cid)
            .order_by(Generation.created_at.desc())
            .limit(100)
        )
    ).all()
    return {
        **conversation_output(row),
        "messages": result,
        "attempts": [attempt_output(a) for a in attempts],
        "generations": [generations.output(g) for g in jobs],
        "ai_enabled": get_settings().llm_enabled,
    }


async def send(s: AsyncSession, uid: uuid.UUID, body: SendRequest) -> dict[str, Any]:
    previous = await generations.replay(s, uid, body.operation_id)
    if previous:
        if previous.kind != body.kind or (
            body.conversation_id and body.conversation_id != previous.conversation_id
        ):
            raise HTTPException(409, "operation_conflict")
        return {
            "conversation_id": previous.conversation_id,
            "generation": generations.output(previous),
        }
    generations.require_reply(body.kind)
    generations.require_ai()
    row = (
        await conversation(s, uid, body.conversation_id, lock=True)
        if body.conversation_id
        else None
    )
    if (
        row
        and body.learning_language_code
        and body.learning_language_code != row.learning_language_code
    ):
        raise HTTPException(409, "conversation_language_immutable")
    draft = await drafts.get(s, uid, body.conversation_id)
    drafts.check_revision(draft, body.draft_revision)
    question = question_outside_quotes(draft.text)
    if not question:
        raise HTTPException(422, "empty_message")
    if row:
        await generations.ensure_idle(s, row.id)
    attached = await citations.owned(s, uid, [uuid.UUID(i) for i in draft.citation_ids])
    from glosano.modules.chat.context import ContextError, validate_attachments

    await citations.verify_send(s, uid, attached)
    try:
        validate_attachments(attached)
    except ContextError as exc:
        raise HTTPException(422, str(exc)) from None
    if row is None:
        row = Conversation(
            user_id=uid,
            title=question[:120],
            learning_language_code=body.learning_language_code,
        )
        s.add(row)
        await s.flush()
    lang = await language(s, uid)
    now = datetime.now(UTC)
    message = Message(
        user_id=uid,
        conversation_id=row.id,
        role="user",
        text=draft.text,
        ui_language=lang,
        exercise_id=draft.exercise_id,
        attempt_id=draft.attempt_id,
        created_at=now,
    )
    s.add(message)
    await s.flush()
    for citation in attached:
        # Copy into immutable sent snapshots; prepared IDs remain usable in other drafts.
        fields = {
            k: getattr(citation, k)
            for k in (
                "lesson_id",
                "source_version",
                "title",
                "language_code",
                "selected_text",
                "context_text",
                "from_ordinal",
                "to_ordinal",
                "context_start_offset",
                "context_end_offset",
                "start_offset",
                "end_offset",
                "media_start_ms",
                "media_end_ms",
            )
        }
        s.add(Citation(user_id=uid, conversation_id=row.id, message_id=message.id, **fields))
    assistant = Message(
        user_id=uid,
        conversation_id=row.id,
        role="assistant",
        text="",
        state="pending",
        ui_language=lang,
        created_at=datetime.now(UTC),
    )
    s.add(assistant)
    await s.flush()
    generation = Generation(
        user_id=uid,
        conversation_id=row.id,
        operation_id=body.operation_id,
        kind=body.kind,
        message_id=assistant.id,
        request_message_id=message.id,
        ui_language=lang,
        exercise_kind=body.exercise_kind,
    )
    s.add(generation)
    row.updated_at = now
    drafts.clear_sent(draft, body.draft_revision)
    await s.flush()
    return {"conversation_id": row.id, "generation": generations.output(generation)}


async def remove(s: AsyncSession, uid: uuid.UUID, cid: uuid.UUID) -> None:
    await conversation(s, uid, cid, lock=True)
    await s.execute(delete(Conversation).where(Conversation.id == cid, Conversation.user_id == uid))
