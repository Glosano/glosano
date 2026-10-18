"""0028 seeds the native language of onboarded users from the UI language unless they learn it."""

import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from testcontainers.postgres import PostgresContainer

from glosano.modules.identity.models import UserLearningLanguage
from glosano.modules.identity.repo import UserRepo

BACKEND_ROOT = Path(__file__).resolve().parents[3]


async def test_native_language_migration() -> None:
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        url = pg.get_connection_url()
        env = {**os.environ, "GLOSANO_DATABASE_URL": url}

        def migrate(target: str, *, downgrade: bool = False) -> None:
            result = subprocess.run(  # noqa: S603 -- fixed migration executable
                [sys.executable, "-m", "alembic", "downgrade" if downgrade else "upgrade", target],
                cwd=BACKEND_ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode == 0, result.stdout + result.stderr

        migrate("0027_external_dictionaries")
        engine = create_async_engine(url)
        async with AsyncSession(engine, expire_on_commit=False) as session:
            repo = UserRepo(session)
            user_a = await repo.create(
                email="native-a@example.com", password_hash="hash", display_name="A"
            )
            user_a.profile.ui_language_code = "ru"
            user_b = await repo.create(
                email="native-b@example.com", password_hash="hash", display_name="B"
            )
            user_b.profile.ui_language_code = "ru"
            user_c = await repo.create(
                email="native-c@example.com", password_hash="hash", display_name="C"
            )
            user_c.profile.ui_language_code = "ru"
            user_a.onboarded_at = user_b.onboarded_at = datetime.now(UTC)
            session.add(UserLearningLanguage(user_id=user_a.id, language_code="pt"))
            session.add(UserLearningLanguage(user_id=user_b.id, language_code="ru"))
            session.add(UserLearningLanguage(user_id=user_b.id, language_code="pt"))
            session.add(UserLearningLanguage(user_id=user_c.id, language_code="pt"))
            a_id, b_id, c_id = user_a.id, user_b.id, user_c.id
            await session.commit()

        migrate("0028_native_language")
        async with AsyncSession(engine) as session:
            repo = UserRepo(session)
            a = await repo.get_by_id_full(a_id)
            b = await repo.get_by_id_full(b_id)
            assert a and b
            assert a.profile.native_language_code == "ru"
            assert a.settings.preferred_translation_language_code == "ru"
            assert b.profile.native_language_code is None
            # Never onboarded: picks a native language in onboarding instead.
            c = await repo.get_by_id_full(c_id)
            assert c
            assert c.profile.native_language_code is None
            # After 0028 the user moves the translation target off the UI language.
            a.profile.native_language_code = "uk"
            a.settings.preferred_translation_language_code = "uk"
            await session.commit()

        migrate("0027_external_dictionaries", downgrade=True)
        async with AsyncSession(engine) as session:
            repo = UserRepo(session)
            a = await repo.get_by_id_full(a_id)
            b = await repo.get_by_id_full(b_id)
            assert a and b
            assert a.profile.native_language_code is None
            assert b.profile.native_language_code is None
            # ADR-0011: the translation target follows the UI language again.
            assert a.settings.preferred_translation_language_code == "ru"
        await engine.dispose()
