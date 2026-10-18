"""Validation of user-defined external dictionary URL templates (FLQ-46).

A custom template is an ``http``/``https`` URL containing ``{word}`` at least
once and no other braces. ``{word}`` must not appear in the scheme, host, port
or userinfo, so the looked-up word can never redirect the link to another site.
"""

from typing import Literal
from urllib.parse import urlsplit

TemplateErrorCode = Literal[
    "too_long",
    "invalid_scheme",
    "missing_placeholder",
    "unknown_placeholder",
    "placeholder_in_host",
]

MAX_TEMPLATE_LENGTH = 500
PLACEHOLDER = "{word}"
_ALLOWED_SCHEMES = frozenset({"http", "https"})
# Two distinct values: if {word} reaches scheme/netloc, the two parses differ.
_SENTINELS = ("wordsentinelqxa", "wordsentinelqxb")


class InvalidTemplateError(ValueError):
    def __init__(self, code: TemplateErrorCode) -> None:
        super().__init__(code)
        self.code: TemplateErrorCode = code


def _split(template: str) -> tuple[str, str]:
    try:
        parts = urlsplit(template)
    except ValueError:
        raise InvalidTemplateError("invalid_scheme") from None
    return parts.scheme, parts.netloc


def _check_browser_parsable(template: str) -> None:
    """Reject hosts/ports the browser's URL parser would refuse (no chip would render)."""
    try:
        parts = urlsplit(template)
        parts.port  # noqa: B018 - raises ValueError for non-numeric / out-of-range ports
    except ValueError:
        raise InvalidTemplateError("invalid_scheme") from None
    if any(ch.isspace() for ch in parts.netloc):
        raise InvalidTemplateError("invalid_scheme")


def validate_custom_template(raw: str) -> str:
    """Return the stripped template or raise ``InvalidTemplateError``."""
    template = raw.strip()
    if len(template) > MAX_TEMPLATE_LENGTH:
        raise InvalidTemplateError("too_long")

    scheme_a, netloc_a = _split(template.replace(PLACEHOLDER, _SENTINELS[0]))
    if scheme_a not in _ALLOWED_SCHEMES or not netloc_a:
        raise InvalidTemplateError("invalid_scheme")

    # Stray braces are checked before the missing {word}: "{text}" is an unknown
    # placeholder, not an absent one.
    rest = template.replace(PLACEHOLDER, "")
    if "{" in rest or "}" in rest:
        raise InvalidTemplateError("unknown_placeholder")
    if PLACEHOLDER not in template:
        raise InvalidTemplateError("missing_placeholder")

    scheme_b, netloc_b = _split(template.replace(PLACEHOLDER, _SENTINELS[1]))
    if (
        scheme_a != scheme_b
        or netloc_a != netloc_b
        or any(s in netloc_a or s in scheme_a for s in _SENTINELS)
    ):
        raise InvalidTemplateError("placeholder_in_host")
    # Last, so a {word} in the port still reports placeholder_in_host.
    _check_browser_parsable(template.replace(PLACEHOLDER, _SENTINELS[0]))
    return template


def is_valid_custom_template(raw: str) -> bool:
    try:
        validate_custom_template(raw)
    except InvalidTemplateError:
        return False
    return True
