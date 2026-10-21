"""Fresh effective settings shared by API and worker; never fall back on DB failure."""

import hashlib

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.config import Settings, get_settings
from glosano.core.db import session_scope
from glosano.modules.admin.crypto import SecretError, decrypt
from glosano.modules.admin.models import AISettings


async def read_row(session: AsyncSession) -> AISettings | None:
    return await session.scalar(select(AISettings).execution_options(populate_existing=True))


async def effective_settings(
    session: AsyncSession | None = None, *, base: Settings | None = None
) -> Settings:
    original = base or get_settings()
    try:
        if session is None:
            async with session_scope() as s:
                row = await read_row(s)
        else:
            row = await read_row(session)
        if row is None:
            fingerprint = hashlib.sha256(
                repr((original.llm_base_url, original.llm_model, original.llm_api_key)).encode()
            ).hexdigest()
            result = original.model_copy(update={"llm_revision": "env:" + fingerprint})
        else:
            result = original.model_copy(
                update={
                    "llm_enabled": row.enabled,
                    "llm_base_url": row.base_url,
                    "llm_model": row.model,
                    "llm_api_key": decrypt(row.key_ciphertext, original.secret_key)
                    if row.key_ciphertext
                    else "",
                    "llm_revision": f"db:{row.revision}",
                }
            )
    except (SQLAlchemyError, SecretError):
        return original.model_copy(
            update={
                "llm_enabled": False,
                "llm_api_key": "",
                "llm_configuration_error": True,
                "llm_revision": "unavailable",
            }
        )
    if original.llm_force_disabled:
        result.llm_enabled = False
    return result


async def check_current(snapshot: Settings) -> None:
    """Check immediately before each request/retry without changing the operation's snapshot."""
    from glosano.modules.ai_translation.provider import ProviderRejected
    from glosano.modules.ai_translation.service import AIDisabled

    current = await effective_settings()
    if not current.llm_enabled:
        raise AIDisabled
    if current.llm_revision != snapshot.llm_revision:
        raise ProviderRejected("configuration_changed")
