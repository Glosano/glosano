"""Version 1 cue normalization and indivisible timed fragment preparation."""

from __future__ import annotations

import math
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any

from glosano.modules.lesson_library.tokenization import RegexSegmenter, tokenize
from glosano.modules.lesson_library.youtube import VideoImportError


class _TextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def plain_text(value: str) -> str:
    parser = _TextParser()
    parser.feed(value)
    return " ".join("".join(parser.parts).split())


@dataclass(frozen=True)
class Cue:
    text: str
    start_ms: float
    end_ms: float


@dataclass(frozen=True)
class Fragment:
    text: str
    media_start_ms: int
    media_end_ms: int
    cue_start: int
    cue_end: int
    cue_intervals: list[dict[str, int]]


def prepare_fragments(
    cues: list[Cue], language_code: str
) -> tuple[list[dict[str, Any]], list[Fragment]]:
    if len(cues) > 20000:
        raise VideoImportError("limit_exceeded")
    snapshot: list[dict[str, Any]] = []
    previous = -1.0
    size = 0
    seen: set[tuple[str, int, int]] = set()
    for cue in cues:
        if (
            not math.isfinite(cue.start_ms)
            or not math.isfinite(cue.end_ms)
            or cue.start_ms < previous
            or cue.start_ms < 0
            or cue.end_ms <= cue.start_ms
        ):
            raise VideoImportError("invalid_transcript")
        previous = cue.start_ms
        text = plain_text(cue.text)
        size += len(text.encode("utf-8"))
        if size > 5 * 1024 * 1024 or cue.end_ms > 21600000:
            raise VideoImportError("limit_exceeded")
        start, end = round(cue.start_ms), round(cue.end_ms)
        if end <= start or "\x00" in text:
            raise VideoImportError("invalid_transcript")
        if text and (text, start, end) not in seen:
            snapshot.append({"text": text, "start_ms": start, "end_ms": end})
            seen.add((text, start, end))
    grouped: list[dict[str, Any]] = []
    for i, cue in enumerate(snapshot):
        if grouped and grouped[-1]["start_ms"] == cue["start_ms"]:
            grouped[-1]["text"] += " " + cue["text"]
            grouped[-1]["end_ms"] = max(grouped[-1]["end_ms"], cue["end_ms"])
            grouped[-1]["cue_end"] = i
        else:
            grouped.append({**cue, "cue_start": i, "cue_end": i})
    for i, cue in enumerate(grouped[:-1]):
        cue["end_ms"] = min(cue["end_ms"], grouped[i + 1]["start_ms"])
    full_text = " ".join(c["text"] for c in grouped)
    segmenter = RegexSegmenter(language_code)
    boundaries = {s.end for s in segmenter.split_sentences(full_text)}
    fragments: list[Fragment] = []
    current: list[dict[str, Any]] = []
    offset = 0
    words = 0

    def finish() -> None:
        if current:
            fragments.append(
                Fragment(
                    " ".join(c["text"] for c in current),
                    current[0]["start_ms"],
                    current[-1]["end_ms"],
                    current[0]["cue_start"],
                    current[-1]["cue_end"],
                    [{"start_ms": c["start_ms"], "end_ms": c["end_ms"]} for c in current],
                )
            )
            current.clear()

    for cue in grouped:
        count = sum(t.is_word_like for t in tokenize(cue["text"], language_code=language_code))
        if current and (
            cue["start_ms"] - current[-1]["end_ms"] > 1000
            or cue["end_ms"] - current[0]["start_ms"] > 20000
            or words + count > 60
        ):
            finish()
            words = 0
        current.append(cue)
        words += count
        offset += len(cue["text"])
        if offset in boundaries:
            finish()
            words = 0
        offset += 1
    finish()
    if not any(t.is_word_like for t in tokenize(full_text, language_code=language_code)):
        raise VideoImportError("invalid_transcript")
    return snapshot, fragments
