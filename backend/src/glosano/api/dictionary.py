"""Dictionary lookup API (spec Decision 6)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status

from glosano.core.db import SessionDep
from glosano.core.languages import LearningLanguageCode
from glosano.modules.dictionary.links import render_external_links
from glosano.modules.dictionary.provider import WIKTIONARY_ATTRIBUTION, WiktionaryLocalProvider
from glosano.modules.dictionary.repo import DictionaryRepo
from glosano.modules.dictionary.schemas import DictionaryLookupResponse, ExternalLinkOut

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
    links = [
        ExternalLinkOut(name=link.name, url=link.url)
        for link in render_external_links(text, lang, target)
    ]
    return DictionaryLookupResponse(
        availability="available"
        if await DictionaryRepo(session).has_active_pair(lang, target)
        else "not_installed",
        entries=entries,
        attribution=WIKTIONARY_ATTRIBUTION,
        external_links=links,
    )
