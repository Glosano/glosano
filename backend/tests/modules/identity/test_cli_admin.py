"""Installer bootstrap uses real PostgreSQL through the public CLI."""

from __future__ import annotations

import asyncio
import sys
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from glosano.modules.identity.repo import UserRepo


async def invoke(*args: str) -> tuple[int, str]:
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "glosano.cli.main",
        "identity",
        "create-admin",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    output, _ = await process.communicate()
    return process.returncode or 0, output.decode()


async def test_admin_bootstrap_is_idempotent(db_session: AsyncSession) -> None:
    email = f"bootstrap-{uuid.uuid4().hex}@example.com"
    code, output = await invoke(email.upper(), "--if-missing")
    assert code == 0, output
    assert "with password:" in output
    user = await UserRepo(db_session).get_by_email(email)
    assert user is not None and user.role == "admin"
    original_hash = user.password_hash
    code, output = await invoke(email, "--if-missing")
    assert code == 0 and "password unchanged" in output
    assert "with password:" not in output
    await db_session.refresh(user)
    assert user.password_hash == original_hash
    assert (await invoke(email))[0] != 0


async def test_bootstrap_never_promotes_an_existing_learner(db_session: AsyncSession) -> None:
    email = f"learner-{uuid.uuid4().hex}@example.com"
    user = await UserRepo(db_session).create(
        email=email, password_hash="test-only-hash", display_name="Learner", role="learner"
    )
    await db_session.commit()
    code, output = await invoke(email, "--if-missing")
    assert code != 0 and "no changes made" in output
    await db_session.refresh(user)
    assert user.role == "learner" and user.password_hash == "test-only-hash"


async def test_bootstrap_rejects_email_that_cannot_sign_in() -> None:
    code, output = await invoke("owner@machine.local", "--if-missing")
    assert code != 0
    assert "valid email" in output
