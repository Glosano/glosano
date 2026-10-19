"""Domain errors of the vocabulary import."""

from __future__ import annotations


class ImportJobError(Exception):
    """An expected import failure whose `code` may be shown to the user.

    The job runner stores `code` as the job's `error_code` only for subclasses of
    this class; any other exception becomes "internal_error". The message is the
    code itself, never user content or a secret.
    """

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code
