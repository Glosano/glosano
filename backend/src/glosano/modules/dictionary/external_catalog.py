"""Built-in external dictionary catalog (FLQ-46).

Each entry maps our language codes to a site's URL template. ``resolve`` returns
a template containing only ``{word}``, or ``None`` when the site does not
support the pair. The code maps below are plain data: when a site changes its
URL format, one row here changes.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

WordEncoding = Literal["default", "no_slash"]


@dataclass(frozen=True)
class BuiltinDictionary:
    id: str
    name: str
    word_encoding: WordEncoding
    # (src, dst) -> template with only {word}, or None when the pair is unsupported.
    resolve: Callable[[str, str], str | None]


REVERSO_NAMES: dict[str, str] = {
    "en": "english",
    "ru": "russian",
    "pt": "portuguese",
    "es": "spanish",
    "fr": "french",
    "de": "german",
    "zh-Hans": "chinese",
    "ja": "japanese",
    "ar": "arabic",
}

# src -> supported dst; Hindi is absent on the site. Source: bst.constants-en.js (May 2024).
REVERSO_PAIRS: dict[str, frozenset[str]] = {
    "en": frozenset({"ar", "de", "es", "fr", "ja", "pt", "ru", "zh-Hans"}),
    "ru": frozenset({"ar", "de", "en", "es", "fr", "ja", "pt"}),
    "pt": frozenset({"ar", "de", "en", "es", "fr", "ja", "ru"}),
    "es": frozenset({"ar", "de", "en", "fr", "ja", "pt", "ru", "zh-Hans"}),
    "fr": frozenset({"ar", "de", "en", "es", "ja", "pt", "ru", "zh-Hans"}),
    "de": frozenset({"ar", "en", "es", "fr", "ja", "pt", "ru"}),
    "zh-Hans": frozenset({"en", "es", "fr"}),
    "ja": frozenset({"de", "en", "es", "fr", "pt", "ru"}),
    "ar": frozenset({"de", "en", "es", "fr", "pt", "ru"}),
    "hi": frozenset(),
}

GOOGLE_CODES: dict[str, str] = {"zh-Hans": "zh-CN"}
DEEPL_CODES: dict[str, str] = {"zh-Hans": "zh"}
LINGVO_CODES: dict[str, str] = {
    "en": "en",
    "ru": "ru",
    "es": "es",
    "fr": "fr",
    "de": "de",
    "zh-Hans": "zh",
}
LINGVO_NON_RU = frozenset({"en", "es", "fr", "de", "zh-Hans"})
WIKTIONARY_CODES: dict[str, str] = {"zh-Hans": "zh"}


def _reverso(src: str, dst: str) -> str | None:
    if dst not in REVERSO_PAIRS.get(src, frozenset()):
        return None
    return f"https://context.reverso.net/translation/{REVERSO_NAMES[src]}-{REVERSO_NAMES[dst]}/{{word}}"


def _google(src: str, dst: str) -> str | None:
    if src == dst:
        return None
    s, d = GOOGLE_CODES.get(src, src), GOOGLE_CODES.get(dst, dst)
    return f"https://translate.google.com/?sl={s}&tl={d}&text={{word}}&op=translate"


def _deepl(src: str, dst: str) -> str | None:
    if src == dst:
        return None
    s, d = DEEPL_CODES.get(src, src), DEEPL_CODES.get(dst, dst)
    return f"https://www.deepl.com/translator#{s}/{d}/{{word}}"


def _lingvo(src: str, dst: str) -> str | None:
    supported = (src == "ru" and dst in LINGVO_NON_RU) or (dst == "ru" and src in LINGVO_NON_RU)
    if not supported:
        return None
    ui = "ru-ru" if dst == "ru" else "en-us"
    return f"https://www.lingvolive.com/{ui}/translate/{LINGVO_CODES[src]}-{LINGVO_CODES[dst]}/{{word}}"


def _wiktionary(src: str, dst: str) -> str | None:
    return f"https://{WIKTIONARY_CODES.get(dst, dst)}.wiktionary.org/w/index.php?search={{word}}"


BUILTIN_DICTIONARIES: tuple[BuiltinDictionary, ...] = (
    BuiltinDictionary("reverso", "Reverso Context", "default", _reverso),
    BuiltinDictionary("google", "Google Translate", "default", _google),
    BuiltinDictionary("deepl", "DeepL", "no_slash", _deepl),
    BuiltinDictionary("lingvo", "Lingvo", "default", _lingvo),
    BuiltinDictionary("wiktionary", "Wiktionary", "default", _wiktionary),
)


def builtins_for_pair(src: str, dst: str) -> list[tuple[BuiltinDictionary, str]]:
    """Built-ins that support the pair, in catalog order, with their resolved templates."""
    resolved = ((d, d.resolve(src, dst)) for d in BUILTIN_DICTIONARIES)
    return [(d, template) for d, template in resolved if template is not None]
