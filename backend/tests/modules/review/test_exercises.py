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

from glosano.core.config import get_settings
from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.ai_translation.provider import LLMCompletion
from glosano.modules.identity.repo import UserRepo
from glosano.modules.review.exercises import (
    ExerciseParseError,
    generate_exercise,
    translation_feedback,
)
from glosano.modules.review.models import ReviewEvent, ReviewItem
from glosano.modules.review.service import ReviewItemNotFound
from glosano.modules.vocabulary import service as vocab
from glosano.modules.vocabulary.models import PersonalTranslation, TokenItem

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
    from glosano.modules.identity.models import UserProfile

    profile = await s.get(UserProfile, user_id)
    assert profile
    profile.ui_language_code = "ru"
    profile.native_language_code = "ru"
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
    from glosano.modules.ai_translation.service import AIDisabled

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


async def test_ui_language_change_keeps_native_translation_and_feedback_follows_ui(
    monkeypatch: pytest.MonkeyPatch,
):
    from glosano.modules.identity.models import UserProfile
    from glosano.modules.review.exercises import _load_context

    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    provider = FakeProvider([json.dumps({"feedback": "Good"})])
    async with session_scope() as s:
        user_id, ri_id = await _setup_item(s)
        profile = await s.get(UserProfile, user_id)
        assert profile
        profile.ui_language_code = "en"
        ctx = await _load_context(s, user_id=user_id, review_item_id=ri_id)
        assert ctx.target_lang == "ru"
        assert ctx.feedback_lang == "en"
        assert ctx.translation == "каждый"  # the saved native translation stays
        await translation_feedback(
            s,
            user_id=user_id,
            review_item_id=ri_id,
            sentence_translation="Every day",
            user_text="Cada dia",
            provider=provider,
        )
        prompt = str(provider.calls[0]["user"])
        assert "Answer in English" in prompt
        assert "this Russian sentence" in prompt
        assert "Answer in Russian" not in prompt


async def test_exercise_context_uses_native_for_translation(monkeypatch: pytest.MonkeyPatch):
    from glosano.modules.identity.models import UserProfile

    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    provider = FakeProvider([EXAMPLE_JSON, json.dumps({"feedback": "Добре"})])
    async with session_scope() as s:
        user_id, ri_id = await _setup_item(s)
        profile = await s.get(UserProfile, user_id)
        assert profile
        profile.ui_language_code = "ru"
        profile.native_language_code = "uk"
        ri = await s.get(ReviewItem, ri_id)
        assert ri
        await vocab.add_translation(
            s,
            user_id=user_id,
            kind="token",
            item_id=ri.item_id,
            target_language_code="uk",
            translation_text="кожен",
            source_type="user",
        )
        await generate_exercise(
            s, user_id=user_id, kind="example", review_item_id=ri_id, provider=provider
        )
        example = str(provider.calls[0]["user"])
        assert "кожен" in example and "каждый" not in example
        assert "into Ukrainian" in example
        await translation_feedback(
            s,
            user_id=user_id,
            review_item_id=ri_id,
            sentence_translation="Кожен день",
            user_text="Cada dia",
            provider=provider,
        )
        feedback = str(provider.calls[1]["user"])
        assert "this Ukrainian sentence" in feedback
        assert "Answer in Russian" in feedback


async def test_exercise_requires_native_language(monkeypatch: pytest.MonkeyPatch):
    from fastapi import HTTPException

    from glosano.modules.identity.models import UserProfile

    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    async with session_scope() as s:
        user_id, ri_id = await _setup_item(s)
        profile = await s.get(UserProfile, user_id)
        assert profile
        profile.native_language_code = None
        with pytest.raises(HTTPException) as exc:
            await generate_exercise(
                s,
                user_id=user_id,
                kind="example",
                review_item_id=ri_id,
                provider=FakeProvider([EXAMPLE_JSON]),
            )
        assert exc.value.status_code == 409


def test_feedback_prompt_answers_in_ui_language():
    from glosano.modules.review import exercise_prompts as prompts

    feedback = prompts.build_feedback_prompt(
        word="cada",
        sentence_translation="x",
        user_text="y",
        learn_lang="pt",
        target_lang="uk",
        feedback_lang="ru",
    )
    assert "this Ukrainian sentence" in feedback
    assert "Answer in Russian" in feedback
    assert "localized into Russian" in feedback
    assert "Portuguese" in feedback


def test_writing_prompt_splits_translation_and_headings():
    from glosano.modules.review import exercise_prompts as prompts

    writing = prompts.build_writing_prompt(
        pairs=[("cada", None)], learn_lang="pt", target_lang="uk", feedback_lang="ru"
    )
    assert "Ukrainian translation" in writing
    assert "headings and instructions in Russian" in writing


async def test_fill_retries_a_changed_form_and_does_not_score(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    good = {
        "before": "",
        "answer": "Cada",
        "after": " dia é único.",
        "translation": "Каждый день уникален.",
    }
    provider = FakeProvider([json.dumps({**good, "answer": "todos"}), json.dumps(good)])
    async with session_scope() as s:
        user_id, ri_id = await _setup_item(s)
        ri = await s.get(ReviewItem, ri_id)
        assert ri is not None
        before = (ri.due_at, ri.last_reviewed_at, ri.algorithm_state_json.copy())
        result = await generate_exercise(
            s, user_id=user_id, kind="fill_blank", review_item_id=ri_id, provider=provider
        )
        assert result.payload == good
        assert len(provider.calls) == 2
        assert (ri.due_at, ri.last_reviewed_at, ri.algorithm_state_json) == before
        events = (
            (await s.execute(select(ReviewEvent).where(ReviewEvent.user_id == user_id)))
            .scalars()
            .all()
        )
        assert events == []


async def test_exercise_hint_uses_fallback_translation(monkeypatch: pytest.MonkeyPatch):
    from glosano.modules.identity.models import UserProfile

    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    provider = FakeProvider([EXAMPLE_JSON])
    async with session_scope() as s:
        user_id, ri_id = await _setup_item(s)  # only a primary "ru" translation
        profile = await s.get(UserProfile, user_id)
        assert profile
        profile.native_language_code = "uk"
        await generate_exercise(
            s, user_id=user_id, kind="example", review_item_id=ri_id, provider=provider
        )
        example = str(provider.calls[0]["user"])
        assert "Meaning (user's own translation): каждый" in example
        assert "into Ukrainian" in example
