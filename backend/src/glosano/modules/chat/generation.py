"""Bounded worker execution with short owner→conversation publication transactions."""

import asyncio
import hashlib
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from functools import partial
from time import monotonic
from typing import Protocol

import httpx
from sqlalchemy import select

from glosano.core.config import get_settings
from glosano.core.db import session_scope
from glosano.modules.ai_translation.models import AIRequest
from glosano.modules.chat.context import ContextError, build_context
from glosano.modules.chat.models import Attempt, Conversation, Generation, Message
from glosano.modules.chat.protocol import encoded
from glosano.modules.chat.provider import ChatProvider, ProviderError
from glosano.modules.identity.models import User


class Provider(Protocol):
    def stream(self, messages: list[dict[str, str]]) -> AsyncIterator[str]: ...


@asynccontextmanager
async def locked_job(gid: uuid.UUID):
    async with session_scope() as s:
        row = await s.get(Generation, gid)
        if row is None:
            yield s, None
            return
        # Profile hard-delete and child-row FK checks require this exact order.
        owner = await s.scalar(select(User.id).where(User.id == row.user_id).with_for_update())
        conv = await s.scalar(
            select(Conversation.id).where(Conversation.id == row.conversation_id).with_for_update()
        )
        if owner is None or conv is None:
            yield s, None
            return
        row = await s.scalar(
            select(Generation)
            .where(Generation.id == gid)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        yield s, row


async def terminal(gid: uuid.UUID, status: str, code: str) -> None:
    async with locked_job(gid) as (s, job):
        if job is None or job.status not in ("queued", "running"):
            return
        job.status, job.error_code = status, code
        message = await s.get(Message, job.message_id)
        if message:
            message.state, message.text = "error", job.partial_text
        if job.attempt_id:
            attempt = await s.get(Attempt, job.attempt_id)
            if attempt:
                attempt.status, attempt.correct = "failed", None


async def progress(gid: uuid.UUID, text: str | None = None) -> bool:
    async with locked_job(gid) as (s, job):
        if job is None or job.status != "running":
            return False
        job.heartbeat_at = datetime.now(UTC)
        if text is not None:
            job.partial_text = text
            message = await s.get(Message, job.message_id)
            if message:
                message.text = text
        return True


async def monitor(gid: uuid.UUID) -> None:
    while True:
        await asyncio.sleep(1)
        if not get_settings().llm_enabled:
            raise ProviderError("ai_disabled")
        if not await progress(gid):
            raise ProviderError("generation_stopped")


MAX_OUTPUT_CHARS = 64000


async def generate(gid: uuid.UUID, provider: Provider, messages: list[dict[str, str]]) -> str:
    text = ""
    if not await progress(gid):
        raise ProviderError("generation_stopped")
    async for chunk in provider.stream(messages):
        if not get_settings().llm_enabled:
            raise ProviderError("ai_disabled")
        if len(text) + len(chunk) > MAX_OUTPUT_CHARS:
            raise ProviderError("provider_output_limit")
        text += chunk
        if chunk and not await progress(gid, text):
            raise ProviderError("generation_stopped")
    if not text.strip():
        raise ProviderError("empty_output")
    return text


async def run_generation(gid: uuid.UUID, *, provider: Provider | None = None) -> None:
    started = monotonic()
    async with locked_job(gid) as (s, job):
        if job is None or job.status != "queued":
            return
        job.status, job.heartbeat_at = "running", datetime.now(UTC)
        kind = job.kind
    try:
        if kind != "reply":
            raise ProviderError("practice_disabled")
        async with session_scope() as s:
            job = await s.get(Generation, gid)
            if job is None or job.status != "running":
                return
            messages, truncated = await build_context(s, job)
        async with locked_job(gid) as (_, job):
            if job is None or job.status != "running":
                return
            job.context_truncated = truncated
        async with httpx.AsyncClient() as client:
            work = asyncio.create_task(
                generate(
                    gid,
                    provider or ChatProvider(client, active=partial(progress, gid)),
                    messages,
                )
            )
            watch = asyncio.create_task(monitor(gid))
            try:
                async with asyncio.timeout(180):
                    done, _ = await asyncio.wait((work, watch), return_when=asyncio.FIRST_COMPLETED)
                    if watch in done:
                        await watch
                    text = await work
            finally:
                work.cancel()
                watch.cancel()
                await asyncio.gather(work, watch, return_exceptions=True)
        async with locked_job(gid) as (s, job):
            if job is None or job.status != "running":
                return
            if not get_settings().llm_enabled:
                raise ProviderError("ai_disabled")
            message = await s.get(Message, job.message_id)
            if message:
                message.text, message.state = text, "complete"
            job.partial_text, job.status = text, "complete"
            job.heartbeat_at = datetime.now(UTC)
            s.add(
                AIRequest(
                    request_id=gid,
                    user_id=job.user_id,
                    provider="openai-compatible-chat",
                    model=get_settings().llm_model[:255],
                    prompt_hash=hashlib.sha256(encoded(messages).encode()).hexdigest(),
                    selected_text_hash=hashlib.sha256(b"").hexdigest(),
                    latency_ms=int((monotonic() - started) * 1000),
                    success=True,
                )
            )
    except asyncio.CancelledError:
        await terminal(gid, "interrupted", "worker_shutdown")
        raise
    except (ContextError, ProviderError) as exc:
        await terminal(gid, "failed", str(exc))
    except TimeoutError:
        await terminal(gid, "interrupted", "generation_timeout")
    except Exception:
        # Exception repr/ValidationError may embed private model input. Never log them.
        await terminal(gid, "failed", "generation_error")


async def recover_generations() -> None:
    """Durable queued rows survive unavailable Redis; expired runners require explicit retry."""
    from glosano.worker.tasks import enqueue_chat_generation

    async with session_scope() as s:
        queued = list(
            (
                await s.scalars(
                    select(Generation.id).where(Generation.status == "queued").limit(100)
                )
            ).all()
        )
        stale = list(
            (
                await s.scalars(
                    select(Generation.id)
                    .where(
                        Generation.status == "running",
                        Generation.heartbeat_at < datetime.now(UTC) - timedelta(seconds=120),
                    )
                    .limit(100)
                )
            ).all()
        )
    for gid in stale:
        async with locked_job(gid) as (s, job):
            if (
                job is None
                or job.status != "running"
                or (
                    job.heartbeat_at
                    and job.heartbeat_at >= datetime.now(UTC) - timedelta(seconds=120)
                )
            ):
                continue
            job.status, job.error_code = "interrupted", "worker_interrupted"
            message = await s.get(Message, job.message_id)
            if message:
                message.state, message.text = "error", job.partial_text
            if job.attempt_id:
                attempt = await s.get(Attempt, job.attempt_id)
                if attempt:
                    attempt.status, attempt.correct = "failed", None
    for gid in queued:
        await enqueue_chat_generation(gid)
