# ruff: noqa: RUF001, RUF002, RUF003 -- Cyrillic docstrings/comments/sample text
# contain letters that are visually confusable with Latin; intentional.
"""generate_exercise/translation_feedback: fake-провайдер, парсинг, ретрай, ownership."""

import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from flinq.core.config import get_settings
from flinq.core.db import session_scope
from flinq.core.security import hash_password
from flinq.modules.ai_translation.provider import LLMCompletion
from flinq.modules.identity.repo import UserRepo
from flinq.modules.review.exercises import (
    ExerciseParseError,
    generate_exercise,
    translation_feedback,
)
from flinq.modules.review.models import ReviewEvent, ReviewItem
from flinq.modules.review.service import ReviewItemNotFound
from flinq.modules.vocabulary import service as vocab
from flinq.modules.vocabulary.models import PersonalTranslation, TokenItem

NOW = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)


class FakeProvider:
    def __init__(self, texts: list[str]):
        self.texts = list(texts)
        self.calls: list[dict[str, str | int]] = []

    async def complete(self, *, system: str, user: str, max_tokens: int = 100) -> LLMCompletion:
        self.calls.append({"system": system, "user": user, "max_tokens": max_tokens})
        return LLMCompletion(text=self.texts.pop(0), input_tokens=10, output_tokens=20)


async def _make_user(s: AsyncSession) -> uuid.UUID:
    user = await UserRepo(s).create(
        email=f"{uuid.uuid4().hex}@t.io",
        password_hash=hash_password("x"),
        display_name="T",
        role="learner",
    )
    await s.flush()
    return user.id


@pytest.fixture(autouse=True)
async def _clean() -> AsyncIterator[None]:  # pyright: ignore[reportUnusedFunction]
    yield
    async with session_scope() as s:
        for model in (ReviewEvent, ReviewItem, PersonalTranslation, TokenItem):
            await s.execute(delete(model))


async def _setup_item(s: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    """Вернуть (user_id, review_item_id) для tracked-слова с переводом."""
    user_id = await _make_user(s)
    item = await vocab.create_item(
        s,
        user_id=user_id,
        kind="token",
        language_code="pt",
        text="cada",
        status="tracked",
        confidence=1,
    )
    await vocab.add_translation(
        s,
        user_id=user_id,
        kind="token",
        item_id=item.id,
        target_language_code="ru",
        translation_text="каждый",
        source_type="user",
    )
    ri = (await s.execute(select(ReviewItem).where(ReviewItem.item_id == item.id))).scalars().one()
    return user_id, ri.id


EXAMPLE_JSON = json.dumps(
    {
        "sentence": "Cada dia é único.",
        "sentence_translation": "Каждый день уникален.",
        "base_form": "cada",
        "base_form_translation": "каждый",
    }
)

CLOZE_JSON = json.dumps(
    {
        "sentence_with_gap": "___ dia é único.",
        "sentence_translation": "Каждый день уникален.",
        "options": [
            {"text": "Cada", "is_correct": True},
            {"text": "Todo", "is_correct": False},
            {"text": "Muito", "is_correct": False},
            {"text": "Pouco", "is_correct": False},
        ],
    }
)


async def test_example_exercise_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    provider = FakeProvider([EXAMPLE_JSON])
    async with session_scope() as s:
        user_id, ri_id = await _setup_item(s)
        res = await generate_exercise(
            s, user_id=user_id, kind="example", review_item_id=ri_id, provider=provider
        )
    assert res.payload["sentence"] == "Cada dia é único."
    assert provider.calls[0]["max_tokens"] == 500
    # слово и его перевод попали в промпт
    prompt_user = str(provider.calls[0]["user"])
    assert "cada" in prompt_user and "каждый" in prompt_user


async def test_cloze_validates_options_and_retries_once(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    # первый ответ — мусор, второй — валидный: должен получиться ретрай
    provider = FakeProvider(["oops not json", CLOZE_JSON])
    async with session_scope() as s:
        user_id, ri_id = await _setup_item(s)
        res = await generate_exercise(
            s, user_id=user_id, kind="cloze", review_item_id=ri_id, provider=provider
        )
    assert len(res.payload["options"]) == 4
    assert len(provider.calls) == 2


async def test_two_bad_responses_raise_parse_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    provider = FakeProvider(["garbage", '{"options": []}'])
    async with session_scope() as s:
        user_id, ri_id = await _setup_item(s)
        with pytest.raises(ExerciseParseError):
            await generate_exercise(
                s, user_id=user_id, kind="cloze", review_item_id=ri_id, provider=provider
            )


async def test_ai_disabled_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    from flinq.modules.ai_translation.service import AIDisabled

    monkeypatch.setattr(get_settings(), "llm_enabled", False)
    provider = FakeProvider([EXAMPLE_JSON])
    async with session_scope() as s:
        user_id, ri_id = await _setup_item(s)
        with pytest.raises(AIDisabled):
            await generate_exercise(
                s, user_id=user_id, kind="example", review_item_id=ri_id, provider=provider
            )


async def test_foreign_item_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    provider = FakeProvider([EXAMPLE_JSON])
    async with session_scope() as s:
        _, ri_id = await _setup_item(s)
        stranger = await _make_user(s)
        with pytest.raises(ReviewItemNotFound):
            await generate_exercise(
                s, user_id=stranger, kind="example", review_item_id=ri_id, provider=provider
            )


async def test_feedback_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    provider = FakeProvider([json.dumps({"feedback": "Хорошо. Опечатка в слове dia."})])
    async with session_scope() as s:
        user_id, ri_id = await _setup_item(s)
        res = await translation_feedback(
            s,
            user_id=user_id,
            review_item_id=ri_id,
            sentence_translation="Каждый день уникален.",
            user_text="Cada dia e unico.",
            provider=provider,
        )
    assert "Опечатка" in res.payload["feedback"]


async def test_writing_exercise_needs_items(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    provider = FakeProvider([json.dumps({"text": "1. ___ dia...\nОтветы: 1. Cada"})])
    async with session_scope() as s:
        user_id, ri_id = await _setup_item(s)
        res = await generate_exercise(
            s, user_id=user_id, kind="writing", review_item_ids=[ri_id], provider=provider
        )
    assert "Ответы" in res.payload["text"]
    assert provider.calls[0]["max_tokens"] == 1200
