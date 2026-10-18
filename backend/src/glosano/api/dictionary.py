"""Dictionary lookup API (spec Decision 6)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status

from glosano.core.db import SessionDep
from glosano.core.languages import LearningLanguageCode
from glosano.modules.dictionary import external_service
from glosano.modules.dictionary.external_templates import InvalidTemplateError
from glosano.modules.dictionary.provider import WIKTIONARY_ATTRIBUTION, WiktionaryLocalProvider
from glosano.modules.dictionary.repo import DictionaryRepo
from glosano.modules.dictionary.schemas import (
    CustomDictionaryIn,
    DictionaryLookupResponse,
    ExternalDictionariesOut,
    ExternalDictionaryOut,
    LayoutIn,
)

router = APIRouter(prefix="/api/dictionary", tags=["dictionary"])

LangCode = LearningLanguageCode


def _require_user(request: Request) -> uuid.UUID:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    return user_id


@router.get("/lookup", response_model=DictionaryLookupResponse)
async def lookup(
    session: SessionDep,
    request: Request,
    lang: LangCode,
    target: LangCode,
    text: Annotated[str, Query(min_length=1, max_length=256)],
) -> DictionaryLookupResponse:
    _require_user(request)
    entries = await WiktionaryLocalProvider(session).lookup(text, lang, target)
    return DictionaryLookupResponse(
        availability="available"
        if await DictionaryRepo(session).has_active_pair(lang, target)
        else "not_installed",
        entries=entries,
        attribution=WIKTIONARY_ATTRIBUTION,
    )


@router.get("/external", response_model=ExternalDictionariesOut)
async def list_external(
    session: SessionDep, request: Request, src: LangCode, dst: LangCode
) -> ExternalDictionariesOut:
    user_id = _require_user(request)
    return await external_service.list_for_pair(session, user_id, src, dst)


@router.put("/external/layout", response_model=ExternalDictionariesOut)
async def put_layout(
    session: SessionDep, request: Request, src: LangCode, dst: LangCode, body: LayoutIn
) -> ExternalDictionariesOut:
    user_id = _require_user(request)
    return await external_service.set_layout(session, user_id, src, dst, body.visible)


@router.post(
    "/external/custom", response_model=ExternalDictionaryOut, status_code=status.HTTP_201_CREATED
)
async def create_custom(
    session: SessionDep, request: Request, body: CustomDictionaryIn
) -> ExternalDictionaryOut:
    user_id = _require_user(request)
    try:
        return await external_service.create_custom(session, user_id, body)
    except InvalidTemplateError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.code) from exc
    except external_service.CustomDictionaryLimitError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="limit_reached") from exc


@router.patch("/external/custom/{custom_id}", response_model=ExternalDictionaryOut)
async def update_custom(
    session: SessionDep, request: Request, custom_id: uuid.UUID, body: CustomDictionaryIn
) -> ExternalDictionaryOut:
    user_id = _require_user(request)
    try:
        return await external_service.update_custom(session, user_id, custom_id, body)
    except InvalidTemplateError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.code) from exc
    except external_service.CustomDictionaryNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from exc


@router.delete("/external/custom/{custom_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_custom(session: SessionDep, request: Request, custom_id: uuid.UUID) -> None:
    user_id = _require_user(request)
    try:
        await external_service.delete_custom(session, user_id, custom_id)
    except external_service.CustomDictionaryNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from exc
