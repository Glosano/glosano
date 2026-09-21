"""Synthetic user content must not appear in development diagnostics."""

import contextlib
import io

import pytest
from loguru import logger

from glosano.core.config import Settings
from glosano.core.db import get_engine
from glosano.core.logging import configure_logging

MARKER = "PRIVATE_CHAT_SYNTHETIC_MARKER"


def fail_request(prompt: str):
    raise ValueError("safe error")


def test_development_diagnostics_hide_locals():
    output = io.StringIO()
    with contextlib.redirect_stderr(output):
        configure_logging(Settings(env="dev", log_level="DEBUG"))
        prompt = MARKER
        try:
            fail_request(prompt)
        except ValueError:
            logger.exception("Chat failure")
    configure_logging(Settings(env="test"))
    assert MARKER not in output.getvalue()


def test_sql_parameters_hidden():
    assert get_engine().sync_engine.hide_parameters is True


async def test_sql_echo_hides_bound_content(caplog: pytest.LogCaptureFixture):
    from sqlalchemy import text

    engine = get_engine()
    engine.echo = True
    try:
        async with engine.connect() as connection:
            result = await connection.scalar(
                text("SELECT CAST(:private AS TEXT)"), {"private": MARKER}
            )
            assert result == MARKER
    finally:
        engine.echo = False
    assert "SQL parameters hidden" in caplog.text
    assert MARKER not in caplog.text
