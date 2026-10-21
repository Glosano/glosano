"""Kaikki.org JSONL record parsing — pure functions, no I/O (spec Decision 3).

Two shapes:
- `source_lang == "en"` (English-edition English dump): translations come from
  the record/sense `translations` lists filtered by target language code.
- otherwise (foreign-language dumps): each sense's glosses ARE the translation,
  written in the edition's language (== the pair's target by construction).
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import JsonValue

MAX_EXAMPLES_PER_ENTRY = 5


@dataclass(frozen=True)
class ParsedTranslation:
    target_language_code: str
    translation_text: str
    sense_index: int
    usage_note: str | None


@dataclass(frozen=True)
class ParsedExample:
    sense_index: int
    example_text: str
    example_translation: str | None


@dataclass(frozen=True)
class ParsedEntry:
    headword: str
    part_of_speech: str | None
    entry_key: str
    gloss_summary: str | None
    translations: tuple[ParsedTranslation, ...]
    examples: tuple[ParsedExample, ...]


def _objects(value: JsonValue) -> list[dict[str, JsonValue]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("expected a list of objects")
    objects: list[dict[str, JsonValue]] = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("expected an object")
        objects.append(item)
    return objects


def _sense_gloss(sense: dict[str, JsonValue]) -> str:
    glosses = sense.get("glosses", [])
    if not isinstance(glosses, list):
        raise ValueError("expected a list of glosses")
    return "; ".join(g for g in glosses if isinstance(g, str))


def _translations_from_lists(
    record: dict[str, JsonValue], glosses: list[str], target_lang: str
) -> list[ParsedTranslation]:
    out: list[ParsedTranslation] = []
    items: list[tuple[int | None, dict[str, JsonValue]]] = [
        (None, t) for t in _objects(record.get("translations"))
    ]
    for i, sense in enumerate(_objects(record.get("senses"))):
        items.extend((i, t) for t in _objects(sense.get("translations")))
    for sense_i, t in items:
        word = t.get("word")
        if t.get("code") != target_lang or not isinstance(word, str) or not word:
            continue
        raw_note = t.get("sense")
        note = raw_note if isinstance(raw_note, str) else None
        index = sense_i if sense_i is not None else 0
        if sense_i is None and note:
            # Best-effort: map a top-level translation to the sense whose gloss mentions it.
            index = next((j for j, g in enumerate(glosses) if note and note in g), 0)
        out.append(
            ParsedTranslation(
                target_language_code=target_lang,
                translation_text=word,
                sense_index=index,
                usage_note=note,
            )
        )
    return out


def _translations_from_glosses(
    senses: list[dict[str, JsonValue]], target_lang: str
) -> list[ParsedTranslation]:
    out: list[ParsedTranslation] = []
    for i, sense in enumerate(senses):
        text = _sense_gloss(sense)
        if text:
            out.append(
                ParsedTranslation(
                    target_language_code=target_lang,
                    translation_text=text,
                    sense_index=i,
                    usage_note=None,
                )
            )
    return out


def _collect_examples(senses: list[dict[str, JsonValue]]) -> tuple[ParsedExample, ...]:
    out: list[ParsedExample] = []
    for i, sense in enumerate(senses):
        for ex in _objects(sense.get("examples")):
            text = ex.get("text")
            if not isinstance(text, str) or not text:
                continue
            translation = ex.get("translation") or ex.get("english")
            out.append(
                ParsedExample(
                    sense_index=i,
                    example_text=text,
                    example_translation=translation if isinstance(translation, str) else None,
                )
            )
            if len(out) >= MAX_EXAMPLES_PER_ENTRY:
                return tuple(out)
    return tuple(out)


def parse_record(
    record: dict[str, JsonValue], *, source_lang: str, target_lang: str
) -> ParsedEntry | None:
    """Turn one JSONL record into a ParsedEntry, or None when irrelevant."""
    if record.get("lang_code") != ("zh" if source_lang == "zh-Hans" else source_lang):
        return None
    word = record.get("word")
    if not isinstance(word, str) or not word:
        return None
    senses: list[dict[str, JsonValue]] = _objects(record.get("senses"))
    glosses = [_sense_gloss(s) for s in senses]
    pos = record.get("pos")
    if source_lang == "en":
        translations = _translations_from_lists(record, glosses, target_lang)
    else:
        translations = _translations_from_glosses(senses, target_lang)
    if not translations:
        return None
    return ParsedEntry(
        headword=word,
        part_of_speech=pos if isinstance(pos, str) else None,
        entry_key=f"{word}:{pos or ''}:{record.get('etymology_number') or 0}",
        gloss_summary=next((g for g in glosses if g), None),
        translations=tuple(translations),
        examples=_collect_examples(senses),
    )
