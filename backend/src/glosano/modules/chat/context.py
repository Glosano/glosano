"""Conversation-only bounded context, including frozen explicitly discussed work."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.config import get_settings
from glosano.modules.chat.models import (
    Attempt,
    Citation,
    Conversation,
    Exercise,
    Generation,
    Message,
)
from glosano.modules.chat.prompts import system_prompt
from glosano.modules.chat.protocol import encoded


class ContextError(Exception):
    pass


def validate_attachments(attachments: list[Citation]) -> None:
    settings = get_settings()
    if len(attachments) > settings.chat_max_attachments:
        raise ContextError("attachment_count_limit")
    if any(
        len(encoded(citation_data(c))) > settings.chat_attachment_char_limit for c in attachments
    ):
        raise ContextError("attachment_size_limit")


def citation_data(c: Citation) -> dict[str, Any]:
    return {
        "title": c.title,
        "language": c.language_code,
        "selected_text": c.selected_text,
        "context_start_offset": c.context_start_offset,
        "context_end_offset": c.context_end_offset,
        "context_text": c.context_text,
        "source_version": c.source_version,
    }


async def exercise_data(s: AsyncSession, job: Generation, eid: object) -> dict[str, Any]:
    ex = await s.scalar(
        select(Exercise).where(
            Exercise.id == eid,
            Exercise.user_id == job.user_id,
            Exercise.conversation_id == job.conversation_id,
        )
    )
    if ex is None:
        raise ContextError("context_unavailable")
    return {"kind": ex.kind, "prompt": ex.prompt, **ex.public_data, **ex.grading_data}


async def message_data(s: AsyncSession, job: Generation, message: Message) -> dict[str, Any]:
    data: dict[str, Any] = {"text": message.text, "state": message.state}
    attachments = list(
        (
            await s.scalars(
                select(Citation).where(
                    Citation.message_id == message.id, Citation.user_id == job.user_id
                )
            )
        ).all()
    )
    validate_attachments(attachments)
    if attachments:
        data["attachments"] = [citation_data(c) for c in attachments]
    eid = message.exercise_id
    if message.attempt_id:
        attempt = await s.scalar(
            select(Attempt).where(
                Attempt.id == message.attempt_id,
                Attempt.user_id == job.user_id,
                Attempt.conversation_id == job.conversation_id,
            )
        )
        if attempt is None:
            raise ContextError("context_unavailable")
        eid = attempt.exercise_id
        data["attempt"] = {
            "answer": attempt.answer,
            "status": attempt.status,
            "correct": attempt.correct,
            "feedback": attempt.feedback,
        }
    if eid:
        data["exercise"] = await exercise_data(s, job, eid)
    published = (
        await s.scalars(
            select(Exercise).where(
                Exercise.message_id == message.id, Exercise.user_id == job.user_id
            )
        )
    ).all()
    if published:
        data["exercises"] = [
            {"kind": ex.kind, "prompt": ex.prompt, **ex.public_data, **ex.grading_data}
            for ex in published
        ]
    return data


async def build_context(s: AsyncSession, job: Generation) -> tuple[list[dict[str, str]], bool]:
    conversation = await s.get(Conversation, job.conversation_id)
    if conversation is None:
        raise ContextError("context_unavailable")
    anchor_id = job.request_message_id or job.message_id
    anchor = await s.get(Message, anchor_id)
    if anchor is None:
        raise ContextError("context_unavailable")
    mandatory = await message_data(s, job, anchor)
    if job.kind == "evaluation":
        attempt = await s.get(Attempt, job.attempt_id)
        if attempt is None:
            raise ContextError("context_unavailable")
        mandatory = {
            "exercise": await exercise_data(s, job, attempt.exercise_id),
            "answer": attempt.answer,
        }
    system = {
        "role": "system",
        "content": system_prompt(job.ui_language, conversation.learning_language_code),
    }
    current = {"role": "user", "content": encoded(mandatory)}
    budget = get_settings().chat_context_char_budget

    # Count the actual serialized Chat Completions request.
    def size(messages: list[dict[str, str]]) -> int:
        return len(
            encoded(
                {
                    "messages": messages,
                    "model": get_settings().llm_model,
                    "stream": True,
                    "max_tokens": get_settings().chat_answer_max_tokens,
                }
            )
        )

    if size([system, current]) > budget:
        raise ContextError("context_limit")
    recent = list(
        (
            await s.scalars(
                select(Message)
                .where(
                    Message.conversation_id == job.conversation_id,
                    Message.user_id == job.user_id,
                    Message.created_at < anchor.created_at,
                )
                .order_by(Message.created_at.desc(), Message.id.desc())
                .limit(101)
            )
        ).all()
    )
    history: list[dict[str, str]] = []
    truncated = len(recent) > 100
    for previous in recent[:100]:
        candidate = {
            "role": previous.role,
            "content": (
                previous.text
                if previous.role == "assistant"
                else encoded(await message_data(s, job, previous))
            ),
        }
        if size([system, candidate, *history, current]) > budget:
            truncated = True
            break
        history.insert(0, candidate)
    return [system, *history, current], truncated
