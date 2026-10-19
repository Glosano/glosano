"""httpx client for the LingQ cards API and the card_from_api mapping.

Retry discipline mirrors ai_translation.provider: up to 3 attempts with exponential
backoff on transport errors, 5xx and 429. 401/403 fail immediately as unauthorized,
other 4xx as rejected. Secrecy: the token lives only in the request header — exceptions
carry just a code (no request, response or URL) and logs contain only status codes and
page numbers.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import httpx
from loguru import logger

from glosano.modules.lingq_import.errors import ImportJobError
from glosano.modules.lingq_import.mapping import map_lingq_status
from glosano.modules.lingq_import.records import (
    MAX_MEANINGS_PER_CARD,
    MAX_TAGS_PER_CARD,
    LingqCard,
    Meaning,
)

_MAX_ATTEMPTS = 3
_BACKOFF_BASE_SECONDS = 0.5
_PAGE_SIZE = 100
MAX_PAGES = 1000  # 100 000 cards at page size 100


class LingqError(ImportJobError):
    """A LingQ API failure; carries only its code."""

    code = "lingq_error"

    def __init__(self) -> None:
        super().__init__(type(self).code)


class LingqUnauthorized(LingqError):  # noqa: N818 -- names fixed by the import contract
    code = "lingq_unauthorized"


class LingqUnavailable(LingqError):  # noqa: N818 -- names fixed by the import contract
    code = "lingq_unavailable"


class LingqRejected(LingqError):  # noqa: N818 -- names fixed by the import contract
    code = "lingq_rejected"


class LingqTooManyCards(LingqError):  # noqa: N818 -- name fixed by the import contract
    code = "lingq_too_many_cards"


def lingq_language_code(code: str) -> str:
    """Map a Glosano learning-language code onto LingQ's URL code."""
    return "zh" if code == "zh-Hans" else code


class LingqClient:
    def __init__(
        self,
        token: str,
        *,
        base_url: str,
        timeout: float,
        page_delay: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._token = token
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._page_delay = page_delay
        self._client = client

    def __repr__(self) -> str:
        return f"LingqClient(base_url={self._base_url!r})"

    async def iter_card_pages(
        self, language_code: str
    ) -> AsyncIterator[tuple[int, list[dict[str, Any]]]]:
        """Yield (total count from the first page, results) page by page."""
        own_client = self._client is None
        client = self._client or httpx.AsyncClient(timeout=self._timeout)
        try:
            url = f"{self._base_url}/api/v3/{language_code}/cards/"
            page = 1
            count = 0
            while True:
                if page > 1 and self._page_delay > 0:
                    await asyncio.sleep(self._page_delay)
                body = await self._get_page(client, url, page)
                if body is None:  # 404 after the first page = end of the list
                    return
                if page == 1:
                    count = _as_int(body.get("count")) or 0
                results = _dict_items(body.get("results"))
                yield count, results
                if not results or not body.get("next"):
                    return
                if page >= MAX_PAGES:
                    logger.warning("lingq: page cap {} reached with more pages left", MAX_PAGES)
                    raise LingqTooManyCards
                page += 1
        finally:
            if own_client:
                await client.aclose()

    async def _get_page(
        self, client: httpx.AsyncClient, url: str, page: int
    ) -> dict[str, Any] | None:
        params: dict[str, str | int] = {"page": page, "page_size": _PAGE_SIZE, "sort": "alpha"}
        headers = {"Authorization": f"Token {self._token}"}
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            response: httpx.Response | None = None
            retryable = True
            try:
                response = await client.get(url, params=params, headers=headers)
            except httpx.RequestError as exc:
                retryable = isinstance(exc, httpx.TransportError)
                logger.warning(
                    "lingq page {} attempt {}/{}: {}",
                    page,
                    attempt,
                    _MAX_ATTEMPTS,
                    type(exc).__name__,
                )
            # Raise only outside the except block so no __context__ (request URL) is attached.
            if not retryable:
                raise LingqRejected
            if response is not None:
                status = response.status_code
                if status < 400:
                    return _parse_page(response)
                if status in (401, 403):
                    logger.warning("lingq page {}: HTTP {}", page, status)
                    raise LingqUnauthorized
                if status == 404:
                    if page == 1:
                        logger.warning("lingq page 1: HTTP 404")
                        raise LingqRejected
                    return None
                if status != 429 and status < 500:
                    logger.warning("lingq page {}: HTTP {}", page, status)
                    raise LingqRejected
                logger.warning(
                    "lingq page {} attempt {}/{}: HTTP {}", page, attempt, _MAX_ATTEMPTS, status
                )
            if attempt < _MAX_ATTEMPTS:
                await asyncio.sleep(_BACKOFF_BASE_SECONDS * 2 ** (attempt - 1))
        raise LingqUnavailable


def _parse_page(response: httpx.Response) -> dict[str, Any]:
    body: object = None
    with contextlib.suppress(ValueError):
        body = response.json()
    if not isinstance(body, dict):
        raise LingqRejected
    return body  # pyright: ignore[reportUnknownVariableType]


def _as_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _as_str(value: object) -> str:
    return value if isinstance(value, str) else ""


def _parse_due(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _dict_items(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    items: list[object] = value  # pyright: ignore[reportUnknownVariableType]
    return [item for item in items if isinstance(item, dict)]  # pyright: ignore[reportUnknownVariableType]


def _string_list(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    items: list[object] = value  # pyright: ignore[reportUnknownVariableType]
    return tuple(t for t in items if isinstance(t, str) and t.strip())


def _union_tags(raw: dict[str, Any]) -> tuple[str, ...]:
    """LingQ splits a card's tags over three fields; the CSV export is their union."""
    merged = (tag for key in ("tags", "wordTags", "gTags") for tag in _string_list(raw.get(key)))
    return tuple(dict.fromkeys(merged))[:MAX_TAGS_PER_CARD]


def card_from_api(raw: dict[str, Any]) -> LingqCard:
    """Map one LingQ card JSON object; never raises on missing or odd fields."""
    meanings: list[Meaning] = []
    for hint in _dict_items(raw.get("hints")):
        text = _as_str(hint.get("text")).strip()
        if not text:
            continue
        locale = hint.get("locale")
        meanings.append(Meaning(locale if isinstance(locale, str) else None, text))
        if len(meanings) == MAX_MEANINGS_PER_CARD:
            break
    tags = _union_tags(raw)
    status, confidence = map_lingq_status(
        _as_int(raw.get("status")), _as_int(raw.get("extended_status"))
    )
    return LingqCard(
        term=_as_str(raw.get("term")).strip(),
        example=_as_str(raw.get("fragment")).strip(),
        tags=tags,
        meanings=tuple(meanings),
        status=status,
        confidence=confidence,
        due_at=_parse_due(raw.get("srs_due_date")),
    )
