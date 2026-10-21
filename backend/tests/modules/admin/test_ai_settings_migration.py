"""Upgrade, safe downgrade, and encrypted backup/restore on real PostgreSQL."""

import os
import subprocess
import sys
from pathlib import Path
from typing import Protocol, cast

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from testcontainers.postgres import PostgresContainer

from glosano.core.config import Settings
from glosano.modules.admin.crypto import encrypt
from glosano.modules.admin.settings import effective_settings


class ExecResult(Protocol):
    exit_code: int
    output: bytes


class Executor(Protocol):
    def exec_run(self, command: list[str]) -> ExecResult: ...


class ContainerAccess(Protocol):
    def get_wrapped_container(self) -> Executor: ...


async def test_migration_and_encrypted_restore():
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        url = pg.get_connection_url()
        env = {**os.environ, "GLOSANO_DATABASE_URL": url}

        def migrate(command: str, revision: str, *, succeeds: bool = True):
            result = subprocess.run(  # noqa: S603
                [sys.executable, "-m", "alembic", command, revision],
                cwd=Path(__file__).resolve().parents[3],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            assert (result.returncode == 0) == succeeds, result.stderr

        migrate("upgrade", "head")
        migrate("downgrade", "0030_import_issues_dropped")
        migrate("upgrade", "head")
        engine = create_async_engine(url)
        secret = "migration-secret-with-at-least-32-characters"
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "INSERT INTO instance_ai_settings "
                    "(id, revision, enabled, base_url, model, key_ciphertext) "
                    "VALUES (1, 4, true, 'http://localhost:1234/v1', 'restored-model', :cipher)"
                ),
                {"cipher": encrypt("provider-key", secret)},
            )
        migrate("downgrade", "0030_import_issues_dropped", succeeds=False)
        container = cast(ContainerAccess, pg).get_wrapped_container()
        result = container.exec_run(
            [
                "sh",
                "-c",
                "createdb -U test restored && pg_dump -U test test | psql -U test -d restored",
            ]
        )
        assert result.exit_code == 0, result.output.decode()
        restored = create_async_engine(url.rsplit("/", 1)[0] + "/restored")
        async with AsyncSession(restored) as session:
            settings = await effective_settings(
                session, base=Settings(secret_key=secret, llm_force_disabled=False)
            )
            assert settings.llm_enabled
            assert settings.llm_model == "restored-model"
            assert settings.llm_api_key == "provider-key"
            locked = await effective_settings(session, base=Settings(secret_key=secret + "changed"))
            assert not locked.llm_enabled and locked.llm_configuration_error
        await restored.dispose()
        await engine.dispose()
