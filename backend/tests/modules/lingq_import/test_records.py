"""Import report: the issue list cap (FLQ-14)."""

from glosano.modules.lingq_import.records import MAX_REPORT_ISSUES, ImportIssue, ImportReport


def test_issues_past_cap_are_counted_as_dropped() -> None:
    report = ImportReport()

    for row in range(MAX_REPORT_ISSUES + 3):
        report.add_issue(ImportIssue(code="empty_term", row=row))

    assert len(report.issues) == MAX_REPORT_ISSUES
    assert report.issues[-1].row == MAX_REPORT_ISSUES - 1
    assert report.issues_dropped == 3


def test_no_dropped_issues_under_cap() -> None:
    report = ImportReport()
    report.add_issue(ImportIssue(code="empty_term", row=2))

    assert report.issues_dropped == 0
