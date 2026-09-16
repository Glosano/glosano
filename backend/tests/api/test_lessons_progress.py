"""GET /api/lessons: процент прочитанного и остаток новых слов (FLQ-8a)."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from glosano.main import create_app

from ._reader_helpers import register_and_onboard, seed_ready_lesson

# Восемь уникальных слов, без повторов — остаток новых слов совпадает с
# числом слов после позиции, поэтому ожидания в тестах читаются глазами.
TEXT = "um dois tres quatro. cinco seis sete oito."


async def _word_ordinals(c: AsyncClient, lesson_id: uuid.UUID) -> list[int]:
    """ordinal_in_lesson всех word-like токенов урока, по порядку."""
    r = await c.get(f"/api/lessons/{lesson_id}/content")
    assert r.status_code == 200
    return [
        tok["i"]
        for para in r.json()["paragraphs"]
        for sent in para["sentences"]
        for tok in sent["tokens"]
        if "i" in tok
    ]


async def _card(c: AsyncClient, lesson_id: uuid.UUID, lang: str = "pt") -> dict[str, Any]:
    r = await c.get(f"/api/lessons?lang={lang}")
    assert r.status_code == 200
    return next(i for i in r.json()["items"] if i["id"] == str(lesson_id))


async def _put_position(
    c: AsyncClient, csrf: str, lesson_id: uuid.UUID, ordinal: int
) -> None:
    r = await c.put(
        "/api/reader/positions",
        json={
            "lesson_id": str(lesson_id),
            "view_mode": "page",
            "current_segment_id": None,
            "current_token_ordinal": ordinal,
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 204


async def test_unopened_lesson_is_zero_percent_with_every_word_new(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-unopened@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        card = await _card(c, lesson_id)
        assert card["read_percent"] == 0
        assert card["new_words_remaining"] == 8


async def test_position_drives_percent_and_shrinks_remaining(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-middle@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)
        ordinals = await _word_ordinals(c, lesson_id)
        assert len(ordinals) == 8

        # Встаём на пятое слово: позади четыре, впереди строго три.
        await _put_position(c, csrf, lesson_id, ordinals[4])

        card = await _card(c, lesson_id)
        # 5/8 = 62.5% -> half-up. Hardcoded rather than recomputed via
        # read_percent()'s own formula, so this pins the documented
        # half-up-rounding contract independently of the implementation.
        assert card["read_percent"] == 63
        assert 0 < card["read_percent"] < 100
        assert card["new_words_remaining"] == 3


async def test_finished_lesson_is_hundred_percent_with_nothing_left(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-finished@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)
        ordinals = await _word_ordinals(c, lesson_id)

        await _put_position(c, csrf, lesson_id, ordinals[-1])

        card = await _card(c, lesson_id)
        assert card["read_percent"] == 100
        assert card["new_words_remaining"] == 0


async def test_word_known_from_another_lesson_is_not_new_here(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Статус слова принадлежит паре (user, language), а не уроку."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-crosslesson@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        r = await c.post(
            "/api/vocabulary/items",
            json={
                "kind": "token",
                "language_code": "pt",
                "text": "cinco",
                "status": "known",
                "confidence": None,
            },
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 201

        card = await _card(c, lesson_id)
        assert card["new_words_remaining"] == 7


async def test_known_word_in_another_language_does_not_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Изоляция по языку: en-слово не гасит одноимённое pt-слово."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-langiso@example.com", lang="pt")
        await c.post(
            "/me/onboarding",
            json={
                "ui_language": "en",
                "learning_languages": ["pt", "en"],
                "translation_language": "en",
            },
            headers={"X-CSRF-Token": csrf},
        )
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        r = await c.post(
            "/api/vocabulary/items",
            json={
                "kind": "token",
                "language_code": "en",
                "text": "cinco",
                "status": "known",
                "confidence": None,
            },
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 201

        card = await _card(c, lesson_id)
        assert card["new_words_remaining"] == 8


async def test_lesson_without_word_tokens_reports_zeroes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Урок из одной пунктуации: агрегат не вернёт по нему строки."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-nowords@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text="...")

        card = await _card(c, lesson_id)
        assert card["read_percent"] == 0
        assert card["new_words_remaining"] == 0


async def test_position_row_without_ordinal_counts_whole_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Урок открывали, но ординала нет — остаток должен быть всем текстом."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-nullordinal@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        r = await c.put(
            "/api/reader/positions",
            json={
                "lesson_id": str(lesson_id),
                "view_mode": "page",
                "current_segment_id": None,
                "current_token_ordinal": None,
            },
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 204

        card = await _card(c, lesson_id)
        assert card["read_percent"] == 0
        assert card["new_words_remaining"] == 8


async def test_all_words_known_leaves_nothing_new(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Процент по-прежнему по позиции, но новых слов не остаётся."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-allknown@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(c, csrf, monkeypatch, text=TEXT)

        for word in ("um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito"):
            r = await c.post(
                "/api/vocabulary/items",
                json={
                    "kind": "token",
                    "language_code": "pt",
                    "text": word,
                    "status": "known",
                    "confidence": None,
                },
                headers={"X-CSRF-Token": csrf},
            )
            assert r.status_code == 201

        card = await _card(c, lesson_id)
        assert card["read_percent"] == 0  # урок не открывали
        assert card["new_words_remaining"] == 0


async def test_underscore_separator_is_not_counted_as_a_permanent_new_word(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`is_word_like("___")` is true but `normalize_token("___")` is "" — a bare
    underscore separator must not inflate new_words_remaining with a word the
    user can never clear through the WordCard (there is no token to click)."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await register_and_onboard(c, "progress-underscore@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(
            c, csrf, monkeypatch, text="um dois ___ tres quatro. cinco seis sete oito."
        )

        card = await _card(c, lesson_id)
        assert card["new_words_remaining"] == 8


async def test_progress_is_per_user(monkeypatch: pytest.MonkeyPatch) -> None:
    """Чужая позиция по shared-уроку не протекает в мою карточку."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as reader_a:
        csrf_a = await register_and_onboard(reader_a, "progress-user-a@example.com", lang="pt")
        lesson_id = await seed_ready_lesson(
            reader_a, csrf_a, monkeypatch, text=TEXT, visibility="shared"
        )
        ordinals = await _word_ordinals(reader_a, lesson_id)
        await _put_position(reader_a, csrf_a, lesson_id, ordinals[-1])
        assert (await _card(reader_a, lesson_id))["read_percent"] == 100

    async with AsyncClient(transport=transport, base_url="http://test") as reader_b:
        await register_and_onboard(reader_b, "progress-user-b@example.com", lang="pt")
        card = await _card(reader_b, lesson_id)
        assert card["read_percent"] == 0
        assert card["new_words_remaining"] == 8
