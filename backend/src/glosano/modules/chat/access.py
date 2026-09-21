"""Common ownership and lock ordering for chat transactions."""

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.chat.models import Conversation
from glosano.modules.identity.models import User, UserProfile


def fail(code: int, detail: str) -> None:
    raise HTTPException(code, detail)


async def lock_user(s: AsyncSession, uid: uuid.UUID) -> None:
    if await s.scalar(select(User.id).where(User.id == uid).with_for_update()) is None:
        fail(404, "not_found")


async def conversation(
    s: AsyncSession, uid: uuid.UUID, cid: uuid.UUID, *, lock: bool = False
) -> Conversation:
    stmt = select(Conversation).where(Conversation.id == cid, Conversation.user_id == uid)
    if lock:
        stmt = stmt.with_for_update()
    row = await s.scalar(stmt.execution_options(populate_existing=True))
    if row is None:
        raise HTTPException(404, "not_found")
    return row


async def language(s: AsyncSession, uid: uuid.UUID) -> str:
    return (
        await s.scalar(select(UserProfile.ui_language_code).where(UserProfile.user_id == uid))
        or "en"
    )
