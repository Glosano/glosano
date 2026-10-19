from __future__ import annotations

import pytest

from glosano.core.textnorm import normalize_token
from glosano.modules.lesson_library.tokenization import normalize_phrase
from glosano.modules.lingq_import.mapping import (
    classify_term,
    dedupe_tags,
    map_lingq_status,
    normalize_locale,
)
from glosano.modules.lingq_import.records import ImportIssue, ImportReport


def test_classify_single_word_is_token() -> None:
    assert classify_term("abacaxi", "pt") == ("token", "abacaxi")


def test_classify_two_words_is_phrase() -> None:
    assert classify_term("Apesar de", "pt") == ("phrase", "apesar de")


def test_classify_hyphenated_word_is_token() -> None:
    assert classify_term("meio-dia", "pt") == ("token", "meio-dia")


def test_classify_punctuation_only_is_empty_term() -> None:
    assert classify_term("…", "pt") == ImportIssue(code="empty_term")


def test_classify_nine_words_is_too_long() -> None:
    term = "um dois tres quatro cinco seis sete oito nove"
    assert classify_term(term, "pt") == ImportIssue(code="phrase_too_long")


def test_classify_eight_words_is_still_phrase() -> None:
    term = "um dois tres quatro cinco seis sete oito"
    assert classify_term(term, "pt") == ("phrase", term)


@pytest.mark.parametrize(
    ("term", "language"),
    [("Straße", "de"), ("«ÅNGSTRÖM»", "de"), ("¡Hola!", "es"), ("co-op", "en"), ("don't", "en")],
)
def test_classify_token_key_is_normalize_token(term: str, language: str) -> None:
    assert classify_term(term, language) == ("token", normalize_token(term))


def test_classify_curly_apostrophe_follows_lesson_tokenizer() -> None:
    # The lesson tokenizer splits U+2019 (known FLQ-1 follow-up), so the import
    # must agree with it rather than with normalize_token: otherwise the stored
    # key would never match lesson occurrences.
    assert classify_term("don\u2019t", "en") == (
        "phrase",
        normalize_phrase("don\u2019t", language_code="en"),
    )


@pytest.mark.parametrize(
    ("term", "language"),
    [
        ("我们", "zh-Hans"),
        ("我喜欢学习中文", "zh-Hans"),
        ("ありがとう", "ja"),
        ("日本語を勉強する", "ja"),
    ],
)
def test_classify_cjk_matches_normalize_phrase(term: str, language: str) -> None:
    key = normalize_phrase(term, language_code=language)
    result = classify_term(term, language)
    assert not isinstance(result, ImportIssue)
    kind, got = result
    if len(key.split()) == 1:
        assert (kind, got) == ("token", key)
    else:
        assert (kind, got) == ("phrase", key)


@pytest.mark.parametrize(
    ("locale", "expected"),
    [
        ("ru", "ru"),
        ("zh-cn", "zh-Hans"),
        ("zh", "zh-Hans"),
        ("zh-Hans", "zh-Hans"),
        ("pt-br", "pt"),
        ("PT_BR", "pt"),
        ("sv", None),
        (None, "en"),
        ("", "en"),
        ("  ", "en"),
    ],
)
def test_normalize_locale(locale: str | None, expected: str | None) -> None:
    assert normalize_locale(locale, native_language="en") == expected


def test_dedupe_tags_is_case_insensitive_and_drops_blanks() -> None:
    assert dedupe_tags(["Noun", "noun", "Verb", " "]) == ["Noun", "Verb"]


@pytest.mark.parametrize(
    ("status", "extended", "expected"),
    [
        (0, None, ("tracked", 1)),
        (1, 0, ("tracked", 2)),
        (2, 0, ("tracked", 3)),
        (3, 0, ("tracked", 4)),
        (3, 3, ("known", None)),
        (4, None, ("known", None)),
        (None, None, ("tracked", 1)),
        (99, None, ("tracked", 1)),
    ],
)
def test_map_lingq_status(
    status: int | None, extended: int | None, expected: tuple[str, int | None]
) -> None:
    assert map_lingq_status(status, extended) == expected


def test_report_caps_issues() -> None:
    report = ImportReport()
    for i in range(600):
        report.add_issue(ImportIssue(code="empty_term", row=i))
    assert len(report.issues) == 500
    assert report.skipped == 0


def test_report_truncates_issue_term() -> None:
    report = ImportReport()
    report.add_issue(ImportIssue(code="term_too_long", row=2, term="a" * 300))
    report.add_issue(ImportIssue(code="empty_term", row=3))

    assert report.issues == [
        ImportIssue(code="term_too_long", row=2, term="a" * 100),
        ImportIssue(code="empty_term", row=3),
    ]
