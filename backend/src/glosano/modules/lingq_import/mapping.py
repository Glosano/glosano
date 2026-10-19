"""Pure mapping helpers for the LingQ vocabulary import (no DB access)."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Literal

from glosano.core.languages import SUPPORTED_TRANSLATION_LANGUAGES
from glosano.core.textnorm import normalize_token
from glosano.modules.lesson_library.tokenization import normalize_phrase
from glosano.modules.lingq_import.records import ImportIssue

MAX_PHRASE_WORDS = 8

# Assumption until the LingQ API is verified (Task 10): the (status, extended_status)
# pair maps onto Glosano confidence; status 4 / extended 3 means "known".
_LINGQ_TRACKED_CONFIDENCE = {0: 1, 1: 2, 2: 3, 3: 4}


def classify_term(
    term: str, language_code: str
) -> tuple[Literal["token", "phrase"], str] | ImportIssue:
    """Decide whether an imported term is a token or a phrase and return its join key."""
    key = normalize_phrase(term, language_code=language_code)
    words = len(key.split())
    if words == 0:
        return ImportIssue(code="empty_term")
    if words == 1:
        return "token", normalize_token(term)
    if words > MAX_PHRASE_WORDS:
        return ImportIssue(code="phrase_too_long")
    return "phrase", key


def normalize_locale(locale: str | None, *, native_language: str) -> str | None:
    """Map a source locale onto a supported translation language; None = unsupported."""
    if locale is None or not locale.strip():
        return native_language
    lowered = locale.strip().lower()
    if lowered.startswith("zh"):
        return "zh-Hans"
    base = lowered.replace("_", "-").split("-", 1)[0]
    return base if base in SUPPORTED_TRANSLATION_LANGUAGES else None


def dedupe_tags(tags: Iterable[str]) -> list[str]:
    """Trim tags, drop blanks and case-insensitive duplicates, keep first spelling and order."""
    seen: set[str] = set()
    result: list[str] = []
    for tag in tags:
        stripped = tag.strip()
        key = stripped.casefold()
        if not stripped or key in seen:
            continue
        seen.add(key)
        result.append(stripped)
    return result


def map_lingq_status(
    status: int | None, extended_status: int | None
) -> tuple[Literal["tracked", "known"], int | None]:
    """Map LingQ (status, extended_status) to a Glosano status and confidence."""
    if status == 4 or (status == 3 and extended_status == 3):
        return "known", None
    if status in _LINGQ_TRACKED_CONFIDENCE:
        return "tracked", _LINGQ_TRACKED_CONFIDENCE[status]
    return "tracked", 1
