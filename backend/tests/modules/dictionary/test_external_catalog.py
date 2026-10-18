import pytest

from glosano.modules.dictionary.external_catalog import BUILTIN_DICTIONARIES, builtins_for_pair


def _template(id_: str, src: str, dst: str) -> str | None:
    [d] = [d for d in BUILTIN_DICTIONARIES if d.id == id_]
    return d.resolve(src, dst)


def test_catalog_order() -> None:
    assert [d.id for d in BUILTIN_DICTIONARIES] == [
        "reverso",
        "google",
        "deepl",
        "lingvo",
        "wiktionary",
    ]


def test_catalog_names() -> None:
    assert [d.name for d in BUILTIN_DICTIONARIES] == [
        "Reverso Context",
        "Google Translate",
        "DeepL",
        "Lingvo",
        "Wiktionary",
    ]


@pytest.mark.parametrize(
    ("id_", "src", "dst", "expected"),
    [
        (
            "reverso",
            "pt",
            "ru",
            "https://context.reverso.net/translation/portuguese-russian/{word}",
        ),
        (
            "reverso",
            "en",
            "zh-Hans",
            "https://context.reverso.net/translation/english-chinese/{word}",
        ),
        (
            "google",
            "pt",
            "ru",
            "https://translate.google.com/?sl=pt&tl=ru&text={word}&op=translate",
        ),
        (
            "google",
            "zh-Hans",
            "en",
            "https://translate.google.com/?sl=zh-CN&tl=en&text={word}&op=translate",
        ),
        ("deepl", "pt", "ru", "https://www.deepl.com/translator#pt/ru/{word}"),
        ("deepl", "zh-Hans", "ru", "https://www.deepl.com/translator#zh/ru/{word}"),
        ("lingvo", "es", "ru", "https://www.lingvolive.com/ru-ru/translate/es-ru/{word}"),
        ("lingvo", "ru", "en", "https://www.lingvolive.com/en-us/translate/ru-en/{word}"),
        ("wiktionary", "pt", "ru", "https://ru.wiktionary.org/w/index.php?search={word}"),
        ("wiktionary", "ja", "zh-Hans", "https://zh.wiktionary.org/w/index.php?search={word}"),
    ],
)
def test_resolved_templates(id_: str, src: str, dst: str, expected: str) -> None:
    assert _template(id_, src, dst) == expected


@pytest.mark.parametrize(
    ("id_", "src", "dst"),
    [
        ("reverso", "zh-Hans", "ru"),
        ("reverso", "hi", "en"),
        ("reverso", "ru", "zh-Hans"),
        ("lingvo", "pt", "ru"),
        ("lingvo", "ja", "ru"),
        ("lingvo", "es", "en"),
        ("google", "ru", "ru"),
        ("deepl", "en", "en"),
    ],
)
def test_unsupported_pairs(id_: str, src: str, dst: str) -> None:
    assert _template(id_, src, dst) is None


def test_pairs_select_the_expected_builtins() -> None:
    def ids(src: str, dst: str) -> list[str]:
        return [b.id for b, _ in builtins_for_pair(src, dst)]

    assert ids("en", "ru") == ["reverso", "google", "deepl", "lingvo", "wiktionary"]
    assert ids("pt", "ru") == ["reverso", "google", "deepl", "wiktionary"]
    assert ids("hi", "ru") == ["google", "deepl", "wiktionary"]
    assert ids("ja", "ru") == ["reverso", "google", "deepl", "wiktionary"]
    assert ids("ru", "ru") == ["wiktionary"]


def test_builtins_for_pair_returns_resolved_templates() -> None:
    [(builtin, template)] = [(b, t) for b, t in builtins_for_pair("pt", "ru") if b.id == "deepl"]
    assert builtin.name == "DeepL"
    assert template == "https://www.deepl.com/translator#pt/ru/{word}"


def test_deepl_strips_slashes_others_do_not() -> None:
    enc = {d.id: d.word_encoding for d in BUILTIN_DICTIONARIES}
    assert enc == {
        "reverso": "default",
        "google": "default",
        "deepl": "no_slash",
        "lingvo": "default",
        "wiktionary": "default",
    }
