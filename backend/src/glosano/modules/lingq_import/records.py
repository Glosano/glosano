"""Plain data carriers shared by the CSV parser, the LingQ client and the import core."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Literal

MAX_REPORT_ISSUES = 500
MAX_ISSUE_TERM_LENGTH = 100
MAX_TAGS_PER_CARD = 32
MAX_MEANINGS_PER_CARD = 10


@dataclass(frozen=True)
class Meaning:
    locale: str | None
    text: str


@dataclass(frozen=True)
class LingqCard:
    term: str
    example: str
    tags: tuple[str, ...]
    meanings: tuple[Meaning, ...]
    status: Literal["tracked", "known"] | None = None  # None = CSV, use options default
    confidence: int | None = None
    due_at: datetime | None = None  # aware UTC
    row: int | None = None  # CSV line number (1-based, header = 1)


@dataclass(frozen=True)
class ImportOptions:
    language_code: str
    source: Literal["csv", "lingq"]
    conflict_mode: Literal["keep", "update"]
    import_tags: bool
    native_language: str
    default_status: Literal["tracked", "known"] = "tracked"
    default_confidence: int | None = 1


@dataclass(frozen=True)
class ImportIssue:
    code: str
    row: int | None = None
    term: str | None = None


@dataclass
class ImportReport:
    processed: int = 0
    created_tokens: int = 0
    created_phrases: int = 0
    updated_items: int = 0
    known_words: int = 0
    skipped: int = 0
    issues: list[ImportIssue] = field(default_factory=list[ImportIssue])
    issues_dropped: int = 0  # issues past MAX_REPORT_ISSUES, counted but not listed

    def add_issue(self, issue: ImportIssue) -> None:
        """Record an issue; entries past the cap only bump `issues_dropped`.

        The other counters are the core's job. The term is cut to MAX_ISSUE_TERM_LENGTH
        characters to keep the stored report small.
        """
        if len(self.issues) >= MAX_REPORT_ISSUES:
            self.issues_dropped += 1
            return
        if issue.term is not None and len(issue.term) > MAX_ISSUE_TERM_LENGTH:
            issue = replace(issue, term=issue.term[:MAX_ISSUE_TERM_LENGTH])
        self.issues.append(issue)
