"""Canonical text normalization (ADR-0001).

One function shared by lesson occurrences, the dictionary and the future
vocabulary layer. If this ever changes, already-imported data must be
re-imported — treat the algorithm as frozen.
"""

from __future__ import annotations

import unicodedata

_APOSTROPHES = str.maketrans({"’": "'"})  # noqa: RUF001 -- U+2019 is the point


def normalize_token(surface: str) -> str:
    """NFC, U+2019 -> ', casefold, strip outer punctuation; keep diacritics + internal -/'."""
    s = unicodedata.normalize("NFC", surface).translate(_APOSTROPHES).casefold()
    start, end = 0, len(s)
    while start < end and not s[start].isalnum():
        start += 1
    while end > start and not (
        s[end - 1].isalnum() or unicodedata.category(s[end - 1]).startswith("M")
    ):
        end -= 1
    return s[start:end]
