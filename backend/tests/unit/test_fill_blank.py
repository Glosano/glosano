"""Pure validation of typed practice; run without database fixtures."""

import uuid

import pytest
from pydantic import ValidationError

from glosano.modules.review.exercise_prompts import (
    normalize_fill_answer,
    validate_fill_answer,
    validate_payload,
)
from glosano.modules.review.schemas import SelectedQueueRequest


@pytest.mark.parametrize(
    ("value", "expected"),
    [("  CAFÉ ", "cafe\u0301"), ("BOM   DIA", "bom dia"), ("日本語", "日本語")],
)
def test_normalization(value: str, expected: str) -> None:
    assert normalize_fill_answer(value) == normalize_fill_answer(expected)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("cafe", "café"),
        ("l'amour", "l\u2019amour"),
        ("wellknown", "well-known"),
        ("walked", "walk"),
    ],
)
def test_distinct_surface_forms(value: str, expected: str) -> None:
    assert normalize_fill_answer(value) != normalize_fill_answer(expected)


def test_phrase_payload_preserves_spacing_and_form() -> None:
    payload = {"before": "Say ", "answer": "bom dia", "after": "!", "translation": "Say hello!"}
    validate_payload("fill_blank", payload)
    validate_fill_answer(payload, "bom dia")
    assert payload["before"] + payload["answer"] + payload["after"] == "Say bom dia!"


@pytest.mark.parametrize(
    "changes",
    [
        {"answer": []},
        {"answer": ""},
        {"translation": " "},
        {"before": "_"},
        {"before": "", "after": ""},
        {"after": "x" * 1001},
    ],
)
def test_rejects_unusable_payload(changes: dict[str, object]) -> None:
    payload = {"before": "Say ", "answer": "bom dia", "after": "!", "translation": "Hello"}
    with pytest.raises(ValueError):
        validate_payload("fill_blank", {**payload, **changes})


def test_rejects_other_form_or_leaked_answer() -> None:
    with pytest.raises(ValueError):
        validate_fill_answer({"answer": "walked", "before": "She ", "after": "."}, "walk")
    with pytest.raises(ValueError):
        validate_fill_answer({"answer": "walk", "before": "Walk, then ", "after": "."}, "walk")


def test_selected_queue_bounds_and_language() -> None:
    ids = [uuid.uuid4() for _ in range(21)]
    SelectedQueueRequest(lang="pt", review_item_ids=ids)
    with pytest.raises(ValidationError):
        SelectedQueueRequest(lang="pt", review_item_ids=ids, practice=True)
    with pytest.raises(ValidationError):
        SelectedQueueRequest(lang="pt", review_item_ids=[])


@pytest.mark.parametrize(
    ("learn_lang", "answer", "context"),
    [("zh-Hans", "喜欢", "我喜欢茶"), ("ja", "猫", "猫がいます。")],
)
def test_rejects_revealed_answer_without_word_separators(
    learn_lang: str, answer: str, context: str
) -> None:
    with pytest.raises(ValueError):
        validate_fill_answer(
            {"answer": answer, "before": context, "after": "."}, answer, learn_lang=learn_lang
        )
