"""Personal lesson tags: one normalization for every write and filter (ADR-0026)."""

from __future__ import annotations

import re
import unicodedata

MAX_TAG_LENGTH = 40
MAX_TAGS_PER_LESSON = 20

# Clients split "a, b" themselves, but a raw API call may still send "a,b" as one value.
_SEPARATORS = re.compile(r"[,;，、；]")  # noqa: RUF001
_SPACES = re.compile(r"\s+")


def normalize_tags(values: list[str], *, max_tags: int | None = MAX_TAGS_PER_LESSON) -> list[str]:
    """Return unique normalized tags in first-seen order or raise ValueError.

    `max_tags` caps the result (default: the per-lesson limit); pass None to
    skip the count check, e.g. for library filters, which are not lessons.
    """
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        for piece in _SEPARATORS.split(value):
            tag = _SPACES.sub(" ", unicodedata.normalize("NFC", piece)).strip().lower()
            if not tag or tag in seen:
                continue
            if len(tag) > MAX_TAG_LENGTH:
                raise ValueError(f"tag is longer than {MAX_TAG_LENGTH} characters: {tag}")
            seen.add(tag)
            result.append(tag)
            if max_tags is not None and len(result) > max_tags:
                raise ValueError(f"no more than {max_tags} tags per lesson")
    return result
