"""LingqClient (retry/pagination/secrecy) and card_from_api mapping."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from glosano.modules.lingq_import import lingq_client as client_mod
from glosano.modules.lingq_import.errors import ImportJobError
from glosano.modules.lingq_import.lingq_client import (
    LingqClient,
    LingqRejected,
    LingqTooManyCards,
    LingqUnauthorized,
    LingqUnavailable,
    card_from_api,
    lingq_language_code,
)
from glosano.modules.lingq_import.records import (
    MAX_MEANINGS_PER_CARD,
    MAX_TAGS_PER_CARD,
    Meaning,
)

TOKEN = "tok-123"


@pytest.fixture(autouse=True)
def _no_backoff(  # pyright: ignore[reportUnusedFunction] — autouse fixture
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(client_mod, "_BACKOFF_BASE_SECONDS", 0.0)


def _client(handler: Any) -> LingqClient:
    return LingqClient(
        TOKEN,
        base_url="https://lingq.test",
        timeout=5.0,
        page_delay=0.0,
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )


def _assert_clean(exc: BaseException) -> None:
    assert exc.__cause__ is None
    assert exc.__context__ is None


async def _collect(client: LingqClient, lang: str = "pt") -> list[tuple[int, list[dict[str, Any]]]]:
    return [page async for page in client.iter_card_pages(lang)]


async def test_iterates_pages_until_next_empty() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        page = int(request.url.params["page"])
        if page == 1:
            return httpx.Response(
                200, json={"count": 3, "next": "https://x/?page=2", "results": [{"a": 1}, {"a": 2}]}
            )
        return httpx.Response(200, json={"count": 3, "next": None, "results": [{"a": 3}]})

    pages = await _collect(_client(handler))
    assert pages == [(3, [{"a": 1}, {"a": 2}]), (3, [{"a": 3}])]
    assert [r.url.params["page"] for r in seen] == ["1", "2"]
    assert seen[0].url.path == "/api/v3/pt/cards/"
    assert seen[0].url.params["page_size"] == "100"
    assert seen[0].url.params["sort"] == "alpha"


async def test_404_after_first_page_ends() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params["page"] == "1":
            return httpx.Response(200, json={"count": 100, "next": "n", "results": [{"a": 1}]})
        return httpx.Response(404, json={"detail": "Invalid page."})

    assert await _collect(_client(handler)) == [(100, [{"a": 1}])]


async def test_404_on_first_page_is_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    with pytest.raises(LingqRejected):
        await _collect(_client(handler))


async def test_401_raises_unauthorized_without_retry() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(401)

    with pytest.raises(LingqUnauthorized) as info:
        await _collect(_client(handler))
    assert calls == 1
    assert info.value.code == "lingq_unauthorized"
    _assert_clean(info.value)


async def test_403_raises_unauthorized_without_retry() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(403)

    with pytest.raises(LingqUnauthorized):
        await _collect(_client(handler))
    assert calls == 1


async def test_other_4xx_is_rejected_without_retry() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(400)

    with pytest.raises(LingqRejected) as info:
        await _collect(_client(handler))
    assert calls == 1
    assert info.value.code == "lingq_rejected"


async def test_429_then_200_retries() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(429)
        return httpx.Response(200, json={"count": 1, "next": None, "results": [{"a": 1}]})

    assert await _collect(_client(handler)) == [(1, [{"a": 1}])]
    assert calls == 2


async def test_5xx_three_times_raises_unavailable() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503)

    with pytest.raises(LingqUnavailable) as info:
        await _collect(_client(handler))
    assert calls == 3
    assert info.value.code == "lingq_unavailable"
    _assert_clean(info.value)


async def test_transport_error_raises_unavailable() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise httpx.ConnectError("boom", request=request)

    with pytest.raises(LingqUnavailable) as info:
        await _collect(_client(handler))
    assert calls == 3
    _assert_clean(info.value)


async def test_malformed_body_is_rejected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>not json</html>")

    with pytest.raises(LingqRejected) as info:
        await _collect(_client(handler))
    _assert_clean(info.value)


@pytest.mark.parametrize("exc_type", [httpx.DecodingError, httpx.TooManyRedirects])
async def test_non_transport_request_error_is_rejected_without_retry(
    exc_type: type[httpx.RequestError],
) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise exc_type("boom", request=request)

    with pytest.raises(LingqRejected) as info:
        await _collect(_client(handler))
    assert calls == 1
    _assert_clean(info.value)


async def test_empty_results_end_iteration_even_with_next() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"count": 5, "next": "https://x/?page=9", "results": []})

    assert await _collect(_client(handler)) == [(5, [])]
    assert calls == 1


async def test_page_cap_raises_too_many_cards(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client_mod, "MAX_PAGES", 3)
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"count": 9, "next": "n", "results": [{"a": calls}]})

    client = _client(handler)
    pages: list[tuple[int, list[dict[str, Any]]]] = []
    with pytest.raises(LingqTooManyCards) as info:
        async for page in client.iter_card_pages("pt"):
            pages.append(page)
    assert len(pages) == 3
    assert calls == 3
    assert info.value.code == "lingq_too_many_cards"
    assert isinstance(info.value, ImportJobError)
    _assert_clean(info.value)


async def test_cap_reached_with_no_next_is_not_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client_mod, "MAX_PAGES", 2)

    def handler(request: httpx.Request) -> httpx.Response:
        last = request.url.params["page"] == "2"
        return httpx.Response(
            200, json={"count": 2, "next": None if last else "n", "results": [{"a": 1}]}
        )

    assert len(await _collect(_client(handler))) == 2


async def test_errors_are_import_job_errors() -> None:
    assert issubclass(LingqUnauthorized, ImportJobError)
    assert issubclass(LingqUnavailable, ImportJobError)
    assert issubclass(LingqRejected, ImportJobError)


async def test_sends_token_header() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"count": 0, "next": None, "results": []})

    await _collect(_client(handler))
    assert seen[0].headers["Authorization"] == f"Token {TOKEN}"


async def test_token_not_in_repr_or_exception_or_logs(caplog: pytest.LogCaptureFixture) -> None:
    from loguru import logger

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text=f"echo {TOKEN}")

    client = _client(handler)
    sink_id = logger.add(lambda m: logging.getLogger("loguru").warning(m), level="DEBUG")
    try:
        with caplog.at_level(logging.DEBUG), pytest.raises(LingqUnavailable) as info:
            await _collect(client)
    finally:
        logger.remove(sink_id)
    exc = info.value
    for text in (repr(client), str(exc), repr(exc), repr(exc.args), caplog.text):
        assert TOKEN not in text
    assert "500" in caplog.text


async def test_language_code_mapping() -> None:
    assert lingq_language_code("zh-Hans") == "zh"
    assert lingq_language_code("pt") == "pt"
    assert lingq_language_code("ja") == "ja"


def test_card_from_api_maps_fields() -> None:
    card = card_from_api(
        {
            "term": "casa",
            "fragment": "Minha casa.",
            "hints": [
                {"locale": "en", "text": "house"},
                {"locale": "ru", "text": ""},
                {"locale": "ru", "text": "дом"},
            ],
            "tags": ["a", "b"],
            "wordTags": ["c"],
            "gTags": ["d"],
            "status": 3,
            "extended_status": 3,
            "srs_due_date": "2024-02-09T09:41:15.849817",
        }
    )
    assert card.term == "casa"
    assert card.example == "Minha casa."
    assert card.meanings == (Meaning("en", "house"), Meaning("ru", "дом"))
    assert card.tags == ("a", "b", "c", "d")
    assert (card.status, card.confidence) == ("known", None)
    assert card.due_at == datetime(2024, 2, 9, 9, 41, 15, 849817, tzinfo=UTC)
    assert card.row is None


def test_card_from_api_unions_tags_from_all_fields_in_order() -> None:
    card = card_from_api(
        {
            "term": "acho",
            "tags": ["achar", "eu"],
            "wordTags": ["Verb", "eu", "Noun"],
            "gTags": ["Adverb", "Verb"],
        }
    )
    assert card.tags == ("achar", "eu", "Verb", "Noun", "Adverb")


def test_card_from_api_tag_dedupe_is_exact_only() -> None:
    card = card_from_api({"term": "x", "tags": ["Verb"], "wordTags": ["verb"]})
    assert card.tags == ("Verb", "verb")


def test_card_from_api_tags_tolerate_missing_and_odd_fields() -> None:
    card = card_from_api({"term": "x", "wordTags": ["t1", "", "  ", 5, None, "t2"]})
    assert card.tags == ("t1", "t2")
    card = card_from_api({"term": "x", "tags": [], "gTags": ["g"]})
    assert card.tags == ("g",)
    card = card_from_api({"term": "x", "tags": "oops", "wordTags": {"a": 1}, "gTags": ["g"]})
    assert card.tags == ("g",)


def test_card_from_api_caps_union_of_tags() -> None:
    card = card_from_api(
        {
            "term": "x",
            "tags": [f"a{i}" for i in range(MAX_TAGS_PER_CARD - 1)],
            "wordTags": ["b0", "b1"],
            "gTags": ["c0"],
        }
    )
    assert len(card.tags) == MAX_TAGS_PER_CARD
    assert card.tags[-1] == "b0"


def test_card_from_api_unknown_status_is_tracked_1() -> None:
    card = card_from_api({"term": "x", "status": 99})
    assert (card.status, card.confidence) == ("tracked", 1)


def test_card_from_api_missing_fields_never_raise() -> None:
    card = card_from_api({})
    assert card.term == ""
    assert card.example == ""
    assert card.tags == ()
    assert card.meanings == ()
    assert (card.status, card.confidence) == ("tracked", 1)
    assert card.due_at is None


def test_card_from_api_odd_types_never_raise() -> None:
    card = card_from_api(
        {
            "term": None,
            "fragment": 5,
            "hints": "oops",
            "tags": "oops",
            "status": "3",
            "srs_due_date": 12,
        }
    )
    assert card.term == ""
    assert card.meanings == ()
    assert card.due_at is None
    card = card_from_api(
        {"term": "x", "hints": [None, {"text": None}, {"locale": "en", "text": "ok"}]}
    )
    assert card.meanings == (Meaning("en", "ok"),)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2024-02-09T09:41:15Z", datetime(2024, 2, 9, 9, 41, 15, tzinfo=UTC)),
        ("2024-02-09T11:41:15+02:00", datetime(2024, 2, 9, 9, 41, 15, tzinfo=UTC)),
        ("garbage", None),
        (None, None),
    ],
)
def test_card_from_api_due_date_variants(raw: str | None, expected: datetime | None) -> None:
    assert card_from_api({"term": "x", "srs_due_date": raw}).due_at == expected


def test_card_from_api_caps_tags_and_meanings() -> None:
    card = card_from_api(
        {
            "term": "x",
            "tags": [f"t{i}" for i in range(100)],
            "hints": [{"locale": "en", "text": f"m{i}"} for i in range(100)],
        }
    )
    assert len(card.tags) == MAX_TAGS_PER_CARD
    assert card.tags[0] == "t0"
    assert len(card.meanings) == MAX_MEANINGS_PER_CARD
