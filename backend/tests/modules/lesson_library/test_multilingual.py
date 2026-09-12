# ruff: noqa: RUF001 -- Unicode punctuation is intentionally tested.
"""Surface forms and offsets remain intact across supported scripts."""

import pytest

from flinq.modules.lesson_library.tokenization import RegexSegmenter, normalize_phrase, tokenize


@pytest.mark.parametrize(
    ("lang", "text", "words"),
    [
        ("zh-Hans", "我喜欢学习中文。", ["我", "喜欢", "学习", "中文"]),
        ("ja", "私の名前は中野です。", ["私", "の", "名前", "は", "中野", "です"]),
        ("hi", "मुझे हिन्दी सीखना है।", ["मुझे", "हिन्दी", "सीखना", "है"]),
        ("ar", "أُحِبُّ تعلُّم العربية؟", ["أُحِبُّ", "تعلُّم", "العربية"]),
    ],
)
def test_language_tokenizer_preserves_surface_offsets(lang: str, text: str, words: list[str]):
    tokens = tokenize(text, language_code=lang, base_offset=17)
    assert [t.surface_text for t in tokens if t.is_word_like] == words
    for token in tokens:
        assert text[token.start_char_offset - 17 : token.end_char_offset - 17] == token.surface_text
    assert normalize_phrase(text, language_code=lang) == " ".join(
        t.normalized_text for t in tokens if t.is_word_like
    )


@pytest.mark.parametrize(
    ("lang", "text", "sentences"),
    [
        ("zh-Hans", "我喜欢学习中文。你呢？很好！", ["我喜欢学习中文。", "你呢？", "很好！"]),
        ("ja", "日本語です。楽しいです！", ["日本語です。", "楽しいです！"]),
        ("hi", "मुझे हिन्दी सीखना है। यह अच्छा है।", ["मुझे हिन्दी सीखना है।", "यह अच्छा है।"]),
        ("ar", "كيف حالك؟ أنا بخير. شكرا!", ["كيف حالك؟", "أنا بخير.", "شكرا!"]),
    ],
)
def test_caseless_sentence_boundaries(lang: str, text: str, sentences: list[str]):
    spans = RegexSegmenter(lang).split_sentences(text, base_offset=9)
    assert [span.text for span in spans] == sentences
    for span in spans:
        assert text[span.start - 9 : span.end - 9] == span.text


@pytest.mark.parametrize("word", ["मुझे", "हिन्दी", "أُحِبُّ"])
def test_normalization_preserves_final_combining_marks(word: str):
    import unicodedata

    from flinq.core.textnorm import normalize_token

    assert normalize_token(f"«{word}!»") == unicodedata.normalize("NFC", word).casefold()


def test_chinese_dictionary_language_code_alias():
    from flinq.modules.dictionary.kaikki import parse_record

    entry = parse_record(
        {"lang_code": "zh", "word": "学习", "senses": [{"glosses": ["to study"]}]},
        source_lang="zh-Hans",
        target_lang="en",
    )
    assert entry is not None
    assert entry.headword == "学习"
    assert entry.translations[0].translation_text == "to study"


@pytest.mark.parametrize("lang,word", [("ja", "ばなな"), ("zh-Hans", "café")])
def test_cjk_segmentation_keeps_canonical_equivalent_words(lang: str, word: str):
    import unicodedata

    decomposed = unicodedata.normalize("NFD", word)
    tokens = tokenize(decomposed, language_code=lang, base_offset=5)
    assert [t.normalized_text for t in tokens] == [word]
    assert tokens[0].surface_text == decomposed
    assert tokens[0].start_char_offset == 5
    assert tokens[0].end_char_offset == 5 + len(decomposed)


@pytest.mark.parametrize("lang", ["zh-Hans", "ja"])
def test_cjk_lessons_preserve_latin_contractions(lang: str):
    assert [t.surface_text for t in tokenize("don't co-operate", language_code=lang)] == [
        "don't",
        "co-operate",
    ]


@pytest.mark.parametrize("lang,text", [("ja", "「こんにちは。」"), ("zh-Hans", "“你好。”")])
def test_closing_quote_stays_in_sentence(lang: str, text: str):
    spans = RegexSegmenter(lang).split_sentences(text, base_offset=3)
    assert [span.text for span in spans] == [text]
    assert spans[0].start == 3 and spans[0].end == 3 + len(text)
