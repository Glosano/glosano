"""Parser for LingQ vocabulary CSV exports.

Extracts raw fields only; classification and normalization of terms belong to the import core.
"""

from __future__ import annotations

import csv
import io
import re

from glosano.modules.lingq_import.errors import ImportJobError
from glosano.modules.lingq_import.records import (
    MAX_MEANINGS_PER_CARD,
    MAX_TAGS_PER_CARD,
    ImportIssue,
    LingqCard,
    Meaning,
)

# At most 4 index digits: a longer number is not a LingQ column (MAX_COLUMNS caps the header
# anyway) and int() would refuse one over 4300 digits. Such a column is ignored.
_TAG_COLUMN = re.compile(r"tag(\d{1,4})")
_MEANING_COLUMN = re.compile(r"meaning(\d{1,4})")
_MEANING_LANGUAGE_COLUMN = re.compile(r"meaninglanguage(\d{1,4})")

# Bounds on the work one upload can cause.
MAX_COLUMNS = 200
MAX_RECORDS = 20_000


class CsvFormatError(ImportJobError):
    """The uploaded file is not a usable LingQ CSV export."""


def parse_lingq_csv(data: bytes) -> tuple[list[LingqCard], list[ImportIssue]]:
    """Parse a LingQ CSV export into raw cards plus per-row issues.

    Columns are located by header name, so their order does not matter. ``row`` is the
    1-based file line on which the record starts (the header is line 1).
    """
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise CsvFormatError("csv_not_utf8") from exc
    try:
        return _parse_records(text)
    except csv.Error as exc:  # e.g. a cell over the csv module's field size limit
        raise CsvFormatError("csv_malformed") from exc


def _parse_records(text: str) -> tuple[list[LingqCard], list[ImportIssue]]:
    reader = csv.reader(io.StringIO(text, newline=""))
    header = next(reader, None)
    if header is None:
        raise CsvFormatError("csv_missing_term_column")
    if len(header) > MAX_COLUMNS:
        raise CsvFormatError("csv_malformed")
    columns = _index_columns(header)
    if "term" not in columns:
        raise CsvFormatError("csv_missing_term_column")

    term_at = columns["term"]
    example_at = columns.get("phrase")
    tag_at = _numbered_indices(columns, _TAG_COLUMN)
    meaning_at = _meaning_indices(columns)

    cards: list[LingqCard] = []
    issues: list[ImportIssue] = []
    previous_line = reader.line_num
    records = 0
    for record in reader:
        row = previous_line + 1
        previous_line = reader.line_num
        if not record:  # blank line
            continue
        records += 1
        if records > MAX_RECORDS:
            raise CsvFormatError("csv_too_many_rows")

        term = _cell(record, term_at)
        if not term:
            issues.append(ImportIssue(code="empty_term", row=row))
            continue

        tags = tuple(tag for index in tag_at if (tag := _cell(record, index)))[:MAX_TAGS_PER_CARD]
        meanings: list[Meaning] = []
        for language_index, text_index in meaning_at:
            meaning = _cell(record, text_index)
            if not meaning:
                continue
            locale = _cell(record, language_index) if language_index is not None else ""
            meanings.append(Meaning(locale or None, meaning))
            if len(meanings) == MAX_MEANINGS_PER_CARD:
                break

        cards.append(
            LingqCard(
                term=term,
                example=_cell(record, example_at) if example_at is not None else "",
                tags=tags,
                meanings=tuple(meanings),
                row=row,
            )
        )
    return cards, issues


def _index_columns(header: list[str]) -> dict[str, int]:
    columns: dict[str, int] = {}
    for index, name in enumerate(header):
        columns.setdefault(name.strip().lower(), index)
    return columns


def _numbered_indices(columns: dict[str, int], pattern: re.Pattern[str]) -> list[int]:
    numbered = [
        (int(match.group(1)), index)
        for name, index in columns.items()
        if (match := pattern.fullmatch(name))
    ]
    return [index for _, index in sorted(numbered)]


def _meaning_indices(columns: dict[str, int]) -> list[tuple[int | None, int]]:
    """Pair ``meaninglanguageN`` with ``meaningN`` columns, ordered by N."""
    languages = {
        int(match.group(1)): index
        for name, index in columns.items()
        if (match := _MEANING_LANGUAGE_COLUMN.fullmatch(name))
    }
    texts = {
        int(match.group(1)): index
        for name, index in columns.items()
        if (match := _MEANING_COLUMN.fullmatch(name))
    }
    return [(languages.get(number), texts[number]) for number in sorted(texts)]


def _cell(record: list[str], index: int) -> str:
    return record[index].strip() if index < len(record) else ""
