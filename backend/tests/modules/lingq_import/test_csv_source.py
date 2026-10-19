from __future__ import annotations

from pathlib import Path

import pytest

from glosano.modules.lingq_import.csv_source import CsvFormatError, parse_lingq_csv
from glosano.modules.lingq_import.records import ImportIssue, LingqCard, Meaning

SAMPLE = Path(__file__).parents[2] / "fixtures" / "lingq" / "sample.csv"


def _by_term(cards: list[LingqCard]) -> dict[str, LingqCard]:
    return {card.term: card for card in cards}


def test_parses_sample() -> None:
    cards, issues = parse_lingq_csv(SAMPLE.read_bytes())

    # 10 data rows, one of them has an empty term
    assert len(cards) == 9
    assert issues == [ImportIssue(code="empty_term", row=11)]

    card = _by_term(cards)["abacaxi"]
    assert card.tags == ("fruta",)
    assert card.meanings == (Meaning("ru", "ананас"),)
    assert card.example == "Eu comi um abacaxi, que estava doce…"
    assert card.row == 2
    assert card.status is None
    assert card.confidence is None
    assert card.due_at is None


def test_sample_keeps_raw_terms_tags_and_second_meaning() -> None:
    cards, _ = parse_lingq_csv(SAMPLE.read_bytes())
    by_term = _by_term(cards)

    assert by_term["Brasil"].term == "Brasil"
    assert by_term["livro"].row == 12  # outer whitespace stripped
    assert by_term["por causa de"].tags == ("Noun", "noun")  # raw, deduped later in core
    assert by_term["casa"].meanings == (Meaning("ru", "дом"), Meaning("en", "house"))


def test_sample_skips_empty_meaning_and_keeps_missing_language_as_none() -> None:
    cards, _ = parse_lingq_csv(SAMPLE.read_bytes())
    by_term = _by_term(cards)

    assert by_term["gato"].meanings == ()
    assert by_term["gato"].tags == ()
    assert by_term["cachorro"].meanings == (Meaning(None, "собака"),)


def test_newline_inside_quoted_field_keeps_start_row() -> None:
    cards, _ = parse_lingq_csv(SAMPLE.read_bytes())
    by_term = _by_term(cards)

    assert by_term["obrigado"].example == "Muito obrigado,\nde verdade."
    assert by_term["obrigado"].row == 9
    # the record after the multi-line one is numbered by its real file line
    assert by_term["livro"].row == 12


def test_columns_by_header_name() -> None:
    data = (
        "meaning2,meaninglanguage2,tag3,meaning1,meaninglanguage1,tag1,tag2,phrase,term\n"
        "house,en,c,дом,ru,a,b,A casa é velha.,casa\n"
    ).encode()

    cards, issues = parse_lingq_csv(data)

    assert issues == []
    assert cards == [
        LingqCard(
            term="casa",
            example="A casa é velha.",
            tags=("a", "b", "c"),
            meanings=(Meaning("ru", "дом"), Meaning("en", "house")),
            row=2,
        )
    ]


def test_tags_ordered_numerically_not_lexically() -> None:
    header = ["term"] + [f"tag{i}" for i in range(1, 12)]
    values = ["casa"] + [f"t{i}" for i in range(1, 12)]
    data = (",".join(header) + "\n" + ",".join(values) + "\n").encode()

    cards, _ = parse_lingq_csv(data)

    assert cards[0].tags == tuple(f"t{i}" for i in range(1, 12))


def test_empty_tag_cells_are_dropped() -> None:
    data = b"term,tag1,tag2,tag3\ncasa,a,,c\n"

    cards, _ = parse_lingq_csv(data)

    assert cards[0].tags == ("a", "c")


def test_missing_optional_columns_are_fine() -> None:
    cards, issues = parse_lingq_csv(b"term\ncasa\n")

    assert issues == []
    assert cards == [LingqCard(term="casa", example="", tags=(), meanings=(), row=2)]


def test_empty_term_row_reported() -> None:
    data = b"term,phrase\ncasa,x\n  ,y\ngato,z\n"

    cards, issues = parse_lingq_csv(data)

    assert [card.term for card in cards] == ["casa", "gato"]
    assert issues == [ImportIssue(code="empty_term", row=3)]


def test_bom_and_crlf_accepted() -> None:
    data = (
        "﻿term,phrase,meaninglanguage1,meaning1\r\ncasa,A casa.,ru,дом\r\ngato,,ru,кот\r\n".encode()
    )

    cards, issues = parse_lingq_csv(data)

    assert issues == []
    assert [card.term for card in cards] == ["casa", "gato"]
    assert cards[0].meanings == (Meaning("ru", "дом"),)
    assert [card.row for card in cards] == [2, 3]


def test_blank_lines_do_not_shift_row_numbers() -> None:
    cards, issues = parse_lingq_csv(b"term\ncasa\n\ngato\n")

    assert issues == []
    assert [(card.term, card.row) for card in cards] == [("casa", 2), ("gato", 4)]


def test_not_utf8_raises() -> None:
    with pytest.raises(CsvFormatError) as excinfo:
        parse_lingq_csv("term\ncasã\n".encode("latin-1"))

    assert excinfo.value.code == "csv_not_utf8"


def test_missing_term_column_raises() -> None:
    with pytest.raises(CsvFormatError) as excinfo:
        parse_lingq_csv(b"phrase,meaning1\nA casa.,house\n")

    assert excinfo.value.code == "csv_missing_term_column"


def test_empty_file_raises_missing_term_column() -> None:
    with pytest.raises(CsvFormatError) as excinfo:
        parse_lingq_csv(b"")

    assert excinfo.value.code == "csv_missing_term_column"


def test_empty_meaning_skipped() -> None:
    data = b"term,meaninglanguage1,meaning1,meaninglanguage2,meaning2\ncasa,ru,,en,house\n"

    cards, _ = parse_lingq_csv(data)

    assert cards[0].meanings == (Meaning("en", "house"),)


def test_oversized_cell_raises_malformed() -> None:
    data = b"term,phrase\ncasa," + b"a" * 200_000 + b"\n"

    with pytest.raises(CsvFormatError) as excinfo:
        parse_lingq_csv(data)

    assert excinfo.value.code == "csv_malformed"


def test_header_column_cap() -> None:
    header = ",".join(["term"] + [f"x{i}" for i in range(199)])
    cards, _ = parse_lingq_csv(f"{header}\ncasa\n".encode())
    assert [card.term for card in cards] == ["casa"]

    with pytest.raises(CsvFormatError) as excinfo:
        parse_lingq_csv(f"{header},x199\ncasa\n".encode())

    assert excinfo.value.code == "csv_malformed"


def test_record_cap() -> None:
    rows = "".join(f"w{i}\n" for i in range(20_000))
    cards, _ = parse_lingq_csv(f"term\n{rows}".encode())
    assert len(cards) == 20_000

    with pytest.raises(CsvFormatError) as excinfo:
        parse_lingq_csv(f"term\n{rows}\n,\n".encode())  # blank lines do not count, records do

    assert excinfo.value.code == "csv_too_many_rows"


def test_tags_and_meanings_capped_per_card() -> None:
    header = ["term"] + [f"tag{i}" for i in range(1, 41)]
    header += [f"meaning{i}" for i in range(1, 13)]
    values = ["casa"] + [f"t{i}" for i in range(1, 41)] + [f"m{i}" for i in range(1, 13)]
    data = (",".join(header) + "\n" + ",".join(values) + "\n").encode()

    cards, _ = parse_lingq_csv(data)

    assert cards[0].tags == tuple(f"t{i}" for i in range(1, 33))
    assert cards[0].meanings == tuple(Meaning(None, f"m{i}") for i in range(1, 11))


def test_huge_column_index_is_ignored_not_a_crash() -> None:
    # int() refuses numbers over 4300 digits; such a header must not turn into a 500.
    digits = "9" * 5000
    header = f"term,tag{digits},meaninglanguage{digits},meaning{digits},tag1"
    data = f"{header}\ncasa,big,ru,дом,noun\n".encode()

    cards, issues = parse_lingq_csv(data)

    assert issues == []
    assert cards[0].tags == ("noun",)
    assert cards[0].meanings == ()
