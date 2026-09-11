"""Промпты и парсинг AI-упражнений (FLQ-20). Чистые функции, без I/O.

Обобщение промптов личного CLI-тренажёра: языки берутся из настроек
пользователя, JSON запрашивается прямо в промпте, парсится extract_json.
"""

from __future__ import annotations

import json
from typing import Any

from flinq.modules.ai_translation.prompts import LANGUAGE_NAMES

SYSTEM_PROMPT = (
    "You are a language tutor inside a vocabulary trainer. "
    "Always reply with a single JSON object exactly matching the requested schema. "
    "No prose outside JSON, no markdown fences."
)

MAX_TOKENS_BY_KIND: dict[str, int] = {
    "example": 500,
    "cloze": 600,
    "reverse": 600,
    "translation_task": 300,
    "writing": 1200,
    "feedback": 500,
}


def _lang(code: str) -> str:
    return LANGUAGE_NAMES.get(code, code)


def _word_block(word: str, translation: str | None, notes: str | None) -> str:
    parts = [f"Word: {word}"]
    if translation:
        parts.append(f"Meaning (user's own translation): {translation}")
    if notes:
        parts.append(f"User notes: {notes}")
    return "\n".join(parts)


def build_example_prompt(
    *,
    word: str,
    translation: str | None,
    notes: str | None,
    learn_lang: str,
    target_lang: str,
) -> str:
    return (
        f"{_word_block(word, translation, notes)}\n"
        f"Write one short {_lang(learn_lang)} sentence (level B1) using the word "
        f"in this exact meaning and the same form. "
        f"Translate the sentence into {_lang(target_lang)}. "
        f"Also give the base form of the word (infinitive / singular) with its "
        f"{_lang(target_lang)} translation.\n"
        'JSON schema: {"sentence": str, "sentence_translation": str, '
        '"base_form": str, "base_form_translation": str}'
    )


def build_cloze_prompt(
    *,
    word: str,
    translation: str | None,
    notes: str | None,
    learn_lang: str,
    target_lang: str,
) -> str:
    return (
        f"{_word_block(word, translation, notes)}\n"
        f"Write one short {_lang(learn_lang)} sentence (level B1) where this word is "
        f"replaced by a gap '___'. Translate the full sentence (no gap) into "
        f"{_lang(target_lang)}. Give 4 answer options in {_lang(learn_lang)}: the "
        f"correct word (in the form fitting the gap) and 3 plausible distractors.\n"
        'JSON schema: {"sentence_with_gap": str, "sentence_translation": str, '
        '"options": [{"text": str, "is_correct": bool} x4, exactly one is_correct=true]}'
    )


def build_reverse_prompt(
    *,
    word: str,
    translation: str | None,
    notes: str | None,
    learn_lang: str,
    target_lang: str,
) -> str:
    return (
        f"{_word_block(word, translation, notes)}\n"
        f"Write one short {_lang(learn_lang)} example sentence with this word. "
        f"Give 4 {_lang(target_lang)} translation options for the word itself: "
        f"the correct one and 3 plausible distractors (synonyms, same topic, "
        f"similar-sounding).\n"
        'JSON schema: {"sentence": str, '
        '"options": [{"text": str, "is_correct": bool} x4, exactly one is_correct=true]}'
    )


def build_translation_task_prompt(
    *,
    word: str,
    translation: str | None,
    notes: str | None,
    learn_lang: str,
    target_lang: str,
) -> str:
    return (
        f"{_word_block(word, translation, notes)}\n"
        f"Write one {_lang(target_lang)} sentence (level A2/B1) whose "
        f"{_lang(learn_lang)} translation naturally uses this word. "
        f"Return only the {_lang(target_lang)} sentence.\n"
        'JSON schema: {"sentence_translation": str}'
    )


def build_writing_prompt(
    *, pairs: list[tuple[str, str | None]], learn_lang: str, target_lang: str
) -> str:
    words = "\n".join(f"- {w} — {t or '(no translation saved)'}" for w, t in pairs)
    return (
        f"The learner struggled with these {_lang(learn_lang)} words:\n{words}\n"
        f"For each word write one {_lang(learn_lang)} sentence with the word replaced "
        f"by a gap '___' (change the word form where natural), followed by its "
        f"{_lang(target_lang)} translation. After all sentences add an 'Answers' "
        f"section listing the correct forms. "
        f"Use headings and instructions in {_lang(target_lang)}. "
        f"Keep the correct forms in {_lang(learn_lang)}. Plain text, numbered.\n"
        'JSON schema: {"text": str}'
    )


def build_feedback_prompt(
    *,
    word: str,
    sentence_translation: str,
    user_text: str,
    learn_lang: str,
    target_lang: str,
) -> str:
    return (
        f"A learner translated this {_lang(target_lang)} sentence into "
        f"{_lang(learn_lang)}:\n"
        f"Sentence: {sentence_translation}\n"
        f"Learner's translation: {user_text}\n"
        f"The sentence practices the word: {word}\n"
        f"Grade the translation (poor / fair / good / excellent, "
        f"localized into {_lang(target_lang)}), point out "
        f"every inaccuracy briefly (missing diacritics and misspellings count), "
        f"and give a correct reference translation in {_lang(learn_lang)}. "
        f"Answer in {_lang(target_lang)}.\n"
        'JSON schema: {"feedback": str}'
    )


def extract_json(text: str) -> dict[str, Any]:
    """Первая '{' … последняя '}' → json.loads. ValueError, если структуры нет."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in response")
    return json.loads(text[start : end + 1])


_REQUIRED_KEYS: dict[str, set[str]] = {
    "example": {"sentence", "sentence_translation", "base_form", "base_form_translation"},
    "cloze": {"sentence_with_gap", "sentence_translation", "options"},
    "reverse": {"sentence", "options"},
    "translation_task": {"sentence_translation"},
    "writing": {"text"},
    "feedback": {"feedback"},
}


def validate_payload(kind: str, payload: dict[str, Any]) -> None:
    """ValueError при отсутствии ключей / неверных options."""
    missing = _REQUIRED_KEYS[kind] - payload.keys()
    if missing:
        raise ValueError(f"missing keys: {sorted(missing)}")
    if kind in ("cloze", "reverse"):
        options = payload["options"]
        if not isinstance(options, list) or len(options) != 4:
            raise ValueError("options must contain exactly 4 items")
        correct = [o for o in options if isinstance(o, dict) and o.get("is_correct") is True]
        if len(correct) != 1:
            raise ValueError("options must contain exactly one correct answer")
