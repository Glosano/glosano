"""parse_record: both dump shapes (spec Decision 3)."""

from __future__ import annotations

import pytest
from pydantic import JsonValue

from glosano.modules.dictionary.kaikki import parse_record

EN_BUILDING: dict[str, JsonValue] = {
    "word": "building",
    "lang_code": "en",
    "pos": "noun",
    "senses": [
        {
            "glosses": ["A structure built for habitation or use"],
            "examples": [{"text": "The building has three floors."}],
        }
    ],
    "translations": [
        {"code": "ru", "word": "здание", "sense": "structure"},
        {"code": "pt", "word": "edifício"},
        {"code": "de", "word": "Gebäude"},
    ],
}

RU_DOM: dict[str, JsonValue] = {
    "word": "дом",
    "lang_code": "ru",
    "pos": "noun",
    "senses": [
        {"glosses": ["house", "building"]},
        {
            "glosses": ["home"],
            "examples": [{"text": "Я иду домой.", "english": "I am going home."}],
        },
    ],
}


def test_en_record_takes_translations_for_target() -> None:
    entry = parse_record(EN_BUILDING, source_lang="en", target_lang="ru")
    assert entry is not None
    assert entry.headword == "building"
    assert entry.entry_key == "building:noun:0"
    assert [t.translation_text for t in entry.translations] == ["здание"]
    assert entry.translations[0].usage_note == "structure"
    assert entry.examples[0].example_text == "The building has three floors."


def test_en_record_other_target_language() -> None:
    entry = parse_record(EN_BUILDING, source_lang="en", target_lang="pt")
    assert entry is not None
    assert [t.translation_text for t in entry.translations] == ["edifício"]


def test_foreign_record_takes_glosses_per_sense() -> None:
    entry = parse_record(RU_DOM, source_lang="ru", target_lang="en")
    assert entry is not None
    texts = [(t.sense_index, t.translation_text) for t in entry.translations]
    assert texts == [(0, "house; building"), (1, "home")]
    assert entry.examples == (
        type(entry.examples[0])(
            sense_index=1,
            example_text="Я иду домой.",
            example_translation="I am going home.",
        ),
    )


def test_wrong_language_is_skipped() -> None:
    assert parse_record(RU_DOM, source_lang="pt", target_lang="ru") is None


def test_record_without_translations_is_skipped() -> None:
    record: dict[str, JsonValue] = {"word": "aaa", "lang_code": "en", "pos": "noun", "senses": []}
    assert parse_record(record, source_lang="en", target_lang="ru") is None


def test_examples_capped_at_five() -> None:
    record: dict[str, JsonValue] = {
        "word": "casa",
        "lang_code": "pt",
        "pos": "noun",
        "senses": [{"glosses": ["дом"], "examples": [{"text": f"ex {i}"} for i in range(10)]}],
    }
    entry = parse_record(record, source_lang="pt", target_lang="ru")
    assert entry is not None
    assert len(entry.examples) == 5


@pytest.mark.parametrize("missing", [None, []])
def test_missing_or_invalid_sense_lists_are_skipped(missing: JsonValue) -> None:
    record: dict[str, JsonValue] = {"word": "casa", "lang_code": "pt", "senses": missing}
    assert parse_record(record, source_lang="pt", target_lang="ru") is None


def test_malformed_nested_values_do_not_become_dictionary_text() -> None:
    record: dict[str, JsonValue] = {
        "word": "house",
        "lang_code": "en",
        "translations": [
            {"code": "ru", "word": 42},
            {"code": "ru", "word": "дом", "sense": []},
        ],
        "senses": [
            {
                "glosses": [False, "building"],
                "examples": [
                    {"text": []},
                    {"text": "A house.", "translation": ["wrong"]},
                    {"text": "My house.", "english": "fallback"},
                ],
            },
        ],
    }
    entry = parse_record(record, source_lang="en", target_lang="ru")
    assert entry is not None
    assert entry.gloss_summary == "building"
    assert [(t.translation_text, t.usage_note) for t in entry.translations] == [("дом", None)]
    assert [(e.example_text, e.example_translation) for e in entry.examples] == [
        ("A house.", None),
        ("My house.", "fallback"),
    ]


@pytest.mark.parametrize("senses", ["invalid", [None], [{"glosses": None}]])
def test_malformed_senses_raise_so_import_counts_skipped_lines(senses: JsonValue) -> None:
    record: dict[str, JsonValue] = {"word": "casa", "lang_code": "pt", "senses": senses}
    with pytest.raises(ValueError):
        parse_record(record, source_lang="pt", target_lang="ru")
