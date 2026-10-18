"""Language catalogs: learning (ADR-0012) and translation targets (FLQ-47)."""

from glosano.core.languages import (
    LANGUAGE_NAMES,
    SUPPORTED_LEARNING_LANGUAGES,
    SUPPORTED_TRANSLATION_LANGUAGES,
)


def test_translation_catalog_is_superset_of_learning() -> None:
    assert SUPPORTED_LEARNING_LANGUAGES < SUPPORTED_TRANSLATION_LANGUAGES
    assert {
        "it",
        "ko",
        "tr",
        "pl",
        "uk",
    } == SUPPORTED_TRANSLATION_LANGUAGES - SUPPORTED_LEARNING_LANGUAGES
    assert len(SUPPORTED_TRANSLATION_LANGUAGES) == 15
    assert all(code in LANGUAGE_NAMES for code in SUPPORTED_TRANSLATION_LANGUAGES)
