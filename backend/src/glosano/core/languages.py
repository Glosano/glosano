"""Supported language catalogs: UI, learning (ADR-0012) and translation targets (ADR-0030)."""

from typing import Literal, get_args

# Interface languages. Arabic is deliberately absent: it is a learning/translation language only.
UI_LANGUAGE_CODES: tuple[str, ...] = ("en", "ru", "pt", "es", "fr", "de", "zh-Hans", "ja", "hi")
UiLanguageCode = Literal["en", "ru", "pt", "es", "fr", "de", "zh-Hans", "ja", "hi"]
LearningLanguageCode = Literal["en", "ru", "pt", "es", "fr", "de", "zh-Hans", "ja", "ar", "hi"]
SUPPORTED_LEARNING_LANGUAGES = frozenset(get_args(LearningLanguageCode))
# Translation targets (native languages) form a superset of the learning catalog (ADR-0030).
TranslationLanguageCode = Literal[
    "en",
    "ru",
    "pt",
    "es",
    "fr",
    "de",
    "zh-Hans",
    "ja",
    "ar",
    "hi",
    "it",
    "ko",
    "tr",
    "pl",
    "uk",
]
SUPPORTED_TRANSLATION_LANGUAGES = frozenset(get_args(TranslationLanguageCode))
LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "ru": "Russian",
    "pt": "Portuguese",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "zh-Hans": "Simplified Chinese",
    "ja": "Japanese",
    "ar": "Arabic",
    "hi": "Hindi",
    "it": "Italian",
    "ko": "Korean",
    "tr": "Turkish",
    "pl": "Polish",
    "uk": "Ukrainian",
}
