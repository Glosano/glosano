"""Segmentation and tokenization for lesson text (ADR-0001).

No DB or network access; CJK segmenters load bundled local resources lazily.
`normalize_token` is the canonical join key shared with the vocabulary layer.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol, cast

from glosano.core.textnorm import normalize_token

_WORD_CHAR_RE = re.compile(r"\w", re.UNICODE)


@dataclass(frozen=True)
class Token:
    surface_text: str
    normalized_text: str
    start_char_offset: int
    end_char_offset: int
    is_word_like: bool


def is_word_like(surface: str) -> bool:
    """True if the token contains at least one word character."""
    return bool(_WORD_CHAR_RE.search(unicodedata.normalize("NFC", surface)))


def _word_char(char: str) -> bool:
    return char.isalnum() or char == "_" or unicodedata.category(char).startswith("M")


def _surface_spans(text: str) -> Iterator[tuple[int, int]]:
    """Word runs include combining marks and internal apostrophes/hyphens."""
    i = 0
    while i < len(text):
        if text[i].isspace():
            i += 1
            continue
        start = i
        if _word_char(text[i]):
            i += 1
            end = i
            while i < len(text) and (_word_char(text[i]) or text[i] in "'-"):
                i += 1
                if _word_char(text[i - 1]):
                    end = i
            i = end
        else:
            i += 1
            while i < len(text) and not text[i].isspace() and not _word_char(text[i]):
                i += 1
        yield start, i


class _ChineseTokenizer(Protocol):
    def tokenize(self, text: str) -> Iterator[tuple[str, int, int]]: ...


class _JapaneseTokenizer(Protocol):
    def tokenize(self, text: str) -> list[str]: ...


@lru_cache(maxsize=1)
def _chinese_tokenizer() -> _ChineseTokenizer:
    from jieba import Tokenizer  # pyright: ignore[reportMissingTypeStubs]

    return cast(_ChineseTokenizer, Tokenizer())


@lru_cache(maxsize=1)
def _japanese_tokenizer() -> _JapaneseTokenizer:
    from tinysegmenter import TinySegmenter  # pyright: ignore[reportMissingTypeStubs]

    return cast(_JapaneseTokenizer, TinySegmenter())


def _is_cjk(char: str) -> bool:
    code = ord(char)
    return (
        0x3040 <= code <= 0x30FF
        or 0x3400 <= code <= 0x9FFF
        or 0xF900 <= code <= 0xFAFF
        or 0x20000 <= code <= 0x323AF
    )


def _cjk_spans(text: str, language_code: str) -> Iterator[tuple[int, int]]:
    # Keep non-CJK runs intact (Latin contractions, Indic vowels, Arabic marks).
    start = 0
    while start < len(text):
        cjk = _is_cjk(text[start])
        end = start + 1
        while end < len(text) and (
            unicodedata.category(text[end]).startswith("M") or _is_cjk(text[end]) == cjk
        ):
            end += 1
        if not cjk:
            yield start, end
        else:
            # Segment an NFC projection, mapping only whole combining clusters
            # back to the original source. Never create a standalone accent token.
            projected = ""
            boundaries = {0: start}
            pos = start
            while pos < end:
                stop = pos + 1
                while stop < end and unicodedata.category(text[stop]).startswith("M"):
                    stop += 1
                projected += unicodedata.normalize("NFC", text[pos:stop])
                boundaries[len(projected)] = stop
                pos = stop
            if language_code == "zh-Hans":
                cuts: list[int] = [b for _, _, b in _chinese_tokenizer().tokenize(projected)]
            else:
                cuts = []
                offset = 0
                for word in _japanese_tokenizer().tokenize(projected):
                    offset += len(word)
                    cuts.append(offset)
            last = start
            for cut in cuts:
                if cut in boundaries:
                    yield last, boundaries[cut]
                    last = boundaries[cut]
        start = end


def tokenize(
    text: str,
    *,
    base_offset: int = 0,
    language_code: str | None = None,
) -> list[Token]:
    """Segment surface forms without changing original character offsets."""
    tokens: list[Token] = []
    for start, end in _surface_spans(text):
        surface = text[start:end]
        spans = (
            list(_cjk_spans(surface, language_code))
            if language_code in {"zh-Hans", "ja"} and is_word_like(surface)
            else [(0, len(surface))]
        )
        for a, b in spans:
            word = surface[a:b]
            tokens.append(
                Token(
                    surface_text=word,
                    normalized_text=normalize_token(word),
                    start_char_offset=base_offset + start + a,
                    end_char_offset=base_offset + start + b,
                    is_word_like=is_word_like(word),
                )
            )
    return tokens


def normalize_phrase(surface: str, *, language_code: str | None = None) -> str:
    """Phrase join key (ADR-0001): normalized word tokens joined by single spaces.

    Uses the same tokenizer as lesson import, so the result always matches the
    `normalized_text` sequence of lesson tokens. Punctuation tokens are dropped,
    as are word-like tokens whose normalized form is empty (e.g. "_", which is
    word-like but normalizes to "") — otherwise they would inject bogus empty
    "words" into the join key.
    """
    return " ".join(
        t.normalized_text
        for t in tokenize(surface, language_code=language_code)
        if t.is_word_like and t.normalized_text
    )


# ---------------------------------------------------------------------------
# Sentence / paragraph segmentation
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Span:
    text: str
    start: int
    end: int


class Segmenter(Protocol):
    """Splits text into paragraphs and sentences with absolute offsets."""

    def split_paragraphs(self, text: str) -> list[Span]: ...

    def split_sentences(self, paragraph: str, *, base_offset: int = 0) -> list[Span]: ...


# Per-language abbreviations (lowercased, without the trailing period).
_ABBREVIATIONS: dict[str, frozenset[str]] = {
    "en": frozenset(
        {
            "mr",
            "mrs",
            "ms",
            "dr",
            "prof",
            "sr",
            "jr",
            "st",
            "vs",
            "etc",
            "inc",
            "ltd",
            "co",
            "no",
            "fig",
            "e.g",
            "i.e",
            "approx",
        }
    ),
    "ru": frozenset(
        {
            "т",
            "д",
            "п",
            "г",
            "гг",
            "стр",
            "рис",
            "см",
            "им",
            "др",
            "пр",
            "тыс",
            "руб",
            "коп",
            "ул",
            "обл",
        }
    ),
    "pt": frozenset(
        {"sr", "sra", "dr", "dra", "prof", "profa", "ex", "av", "núm", "pág", "etc", "ltda", "esq"}
    ),
}

_PARA_SPLIT_RE = re.compile(r"\n[ \t]*\n+")
_SENT_PUNCT_RE = re.compile(r"[.!?…。！？؟।]+")
_LAST_WORD_RE = re.compile(r"(\w+)$", re.UNICODE)
# Characters that may begin a new sentence (used after a boundary dot/punct):
# U+201C left double quote, U+2018 left single quote, U+00AB guillemet,
# straight double quote, straight single quote, open paren, hyphen, U+2014 em dash.
_SENTENCE_START_CHARS = "\u201c\u2018\u00ab\"'(-\u2014"


def _trim_to_span(chunk: str, start: int) -> Span:
    """Strip surrounding whitespace from chunk and return a Span with offsets."""
    stripped = chunk.strip()
    lead = len(chunk) - len(chunk.lstrip())
    real_start = start + lead
    return Span(text=stripped, start=real_start, end=real_start + len(stripped))


class RegexSegmenter:
    """Rule-based sentence boundaries for the learning language catalog."""

    def __init__(self, lang: str) -> None:
        self.lang = lang
        self._abbrevs = _ABBREVIATIONS.get(lang, frozenset())

    def split_paragraphs(self, text: str) -> list[Span]:
        spans: list[Span] = []
        pos = 0
        for m in _PARA_SPLIT_RE.finditer(text):
            chunk = text[pos : m.start()]
            if chunk.strip():
                spans.append(_trim_to_span(chunk, pos))
            pos = m.end()
        tail = text[pos:]
        if tail.strip():
            spans.append(_trim_to_span(tail, pos))
        return spans

    def split_sentences(self, paragraph: str, *, base_offset: int = 0) -> list[Span]:
        spans: list[Span] = []
        n = len(paragraph)
        start = 0
        for m in _SENT_PUNCT_RE.finditer(paragraph):
            end = m.end()
            while end < n and paragraph[end] in '"”’»」』】）)]}':
                end += 1
            after = paragraph[end : end + 1]
            # CJK sentence punctuation does not require following whitespace.
            if after and not after.isspace() and not any(c in m.group() for c in "。！？؟।"):
                continue
            # Skip abbreviations and single-letter initials right before the dot.
            prefix = paragraph[start : m.start()]
            lw = _LAST_WORD_RE.search(prefix)
            if (
                lw is not None
                and m.group() == "."
                and self.lang not in {"zh-Hans", "ja", "ar", "hi"}
            ):
                word = lw.group(1)
                is_abbrev = word.lower() in self._abbrevs or len(word) == 1
                if is_abbrev:
                    # For compound abbreviations like "т.д." the last component
                    # is preceded by a dot (e.g. prefix ends in "т.д").  In that
                    # case we only suppress the split when the following word
                    # does NOT start with an uppercase letter — otherwise we let
                    # the sentence-start check below decide.
                    in_compound = lw.start() > 0 and prefix[lw.start() - 1] == "."
                    if not in_compound:
                        continue
                    # Compound abbreviation: look ahead to see if what follows
                    # is a real sentence start (uppercase).  If not, suppress.
                    j_peek = end
                    while j_peek < n and paragraph[j_peek].isspace():
                        j_peek += 1
                    if j_peek >= n or not paragraph[j_peek].isupper():
                        continue
                    # Falls through to the normal sentence-start check below.
            # Require the next non-space char to look like a sentence start.
            j = end
            while j < n and paragraph[j].isspace():
                j += 1
            if j < n and self.lang not in {"zh-Hans", "ja", "ar", "hi"}:
                nxt = paragraph[j]
                if not (nxt.isupper() or nxt.isdigit() or nxt in _SENTENCE_START_CHARS):
                    continue
            spans.append(_trim_to_span(paragraph[start:end], base_offset + start))
            start = end
        tail = paragraph[start:]
        if tail.strip():
            spans.append(_trim_to_span(tail, base_offset + start))
        return spans
