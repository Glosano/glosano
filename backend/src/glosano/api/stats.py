"""Authenticated statistics overview."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import get_session
from glosano.core.languages import LearningLanguageCode
from glosano.modules.statistics.schemas import Overview
from glosano.modules.statistics.service import get_overview

router = APIRouter(prefix="/api/stats", tags=["statistics"])


@router.get("/overview", response_model=Overview)
async def overview(
    request: Request,
    lang: LearningLanguageCode,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Overview:
    user_id: uuid.UUID | None = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(401)
    return await get_overview(session, user_id=user_id, language_code=lang)
