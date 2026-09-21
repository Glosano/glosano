"""Stable JSON encoding for context envelopes and audit hashes, not model output."""

import json


def encoded(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
