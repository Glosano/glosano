"""Admin configuration commands and safe, explicit diagnostics."""

import asyncio
import json
import time
import uuid
from typing import Literal

import httpx
from fastapi import HTTPException
from loguru import logger
from pydantic import BaseModel, ConfigDict, Field, JsonValue, SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.config import Settings, get_settings
from glosano.modules.admin import network
from glosano.modules.admin.crypto import SecretError, decrypt, encrypt
from glosano.modules.admin.models import AISettings
from glosano.modules.admin.settings import read_row

# Catalogs include descriptions, pricing and capabilities for hundreds of models.
# Keep the short Chat Completions diagnostic on its smaller response budget.
MODELS_RESPONSE_MAX_BYTES = 8 * 1024 * 1024
DIAGNOSTIC_RESPONSE_MAX_BYTES = 256 * 1024


class Draft(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    revision: int = Field(ge=0)
    enabled: bool
    base_url: str = Field(max_length=2048)
    model: str = Field(max_length=255)
    key_action: Literal["keep", "replace", "remove"] = "keep"
    api_key: SecretStr | None = Field(default=None, max_length=8192)


async def view(session: AsyncSession) -> dict[str, object]:
    env = get_settings()
    row = await read_row(session)
    issue: str | None = None
    if row and row.key_ciphertext:
        try:
            decrypt(row.key_ciphertext, env.secret_key)
        except SecretError as exc:
            issue = str(exc)
    return {
        "revision": row.revision if row else 0,
        "source": "database" if row else "environment",
        "enabled": row.enabled if row else env.llm_enabled,
        "base_url": row.base_url if row else env.llm_base_url,
        "model": row.model if row else env.llm_model,
        "has_key": bool(row.key_ciphertext) if row else bool(env.llm_api_key),
        "force_disabled": env.llm_force_disabled,
        "key_error": issue,
    }


async def prepare(session: AsyncSession, draft: Draft, *, needs_model: bool) -> Settings:
    env = get_settings()
    row = await read_row(session)
    if draft.revision != (row.revision if row else 0):
        raise HTTPException(409, "configuration_conflict")
    try:
        url = network.validate_url(draft.base_url)
    except network.EndpointError as exc:
        raise HTTPException(422, str(exc)) from None
    model = draft.model.strip()
    if (draft.enabled or needs_model) and (not url or not model):
        raise HTTPException(422, "endpoint_model_required")
    previous_url = (row.base_url if row else env.llm_base_url).strip().rstrip("/")
    previous_key = row.key_ciphertext if row else env.llm_api_key
    if draft.key_action == "keep":
        if url != previous_url and previous_key:
            raise HTTPException(422, "key_action_required")
        try:
            key = (
                decrypt(row.key_ciphertext, env.secret_key)
                if row and row.key_ciphertext
                else ("" if row else env.llm_api_key)
            )
        except SecretError as exc:
            raise HTTPException(422, str(exc)) from None
    elif draft.key_action == "replace":
        key = draft.api_key.get_secret_value().strip() if draft.api_key else ""
        if not key or any(ord(c) < 32 or ord(c) == 127 for c in key):
            raise HTTPException(422, "api_key_required")
    else:
        key = ""
    return env.model_copy(
        update={
            "llm_enabled": draft.enabled,
            "llm_base_url": url,
            "llm_model": model,
            "llm_api_key": key,
        }
    )


async def save(session: AsyncSession, uid: uuid.UUID, draft: Draft) -> dict[str, object]:
    # Serializes even the initial insert; revision check still rejects stale clients.
    await session.execute(text("SELECT pg_advisory_xact_lock(476567192611)"))
    candidate = await prepare(session, draft, needs_model=False)
    try:
        ciphertext = (
            encrypt(candidate.llm_api_key, candidate.secret_key) if candidate.llm_api_key else None
        )
    except SecretError as exc:
        raise HTTPException(422, str(exc)) from None
    row = await read_row(session)
    if row is None:
        row = AISettings(id=1, revision=0)
        session.add(row)
    row.revision += 1
    row.enabled, row.base_url, row.model = (
        candidate.llm_enabled,
        candidate.llm_base_url,
        candidate.llm_model,
    )
    row.key_ciphertext, row.updated_by = ciphertext, uid
    await session.flush()
    logger.info("AI settings updated (actor={}, revision={})", uid, row.revision)
    return await view(session)


async def diagnose(
    session: AsyncSession, draft: Draft, *, models: bool = False
) -> dict[str, object]:
    if get_settings().llm_force_disabled:
        raise HTTPException(403, "ai_force_disabled")
    candidate = await prepare(session, draft, needs_model=not models)
    if not candidate.llm_base_url:
        raise HTTPException(422, "endpoint_model_required")
    started = time.monotonic()
    try:
        async with asyncio.timeout(15):
            url, headers, extensions = await network.target(
                candidate.llm_base_url + ("/models" if models else "/chat/completions")
            )
            if candidate.llm_api_key:
                headers["Authorization"] = "Bearer " + candidate.llm_api_key
            payload = (
                None
                if models
                else {
                    "model": candidate.llm_model,
                    "messages": [{"role": "user", "content": "Reply with OK."}],
                    "max_tokens": 16,
                    "stream": False,
                }
            )
            async with (
                httpx.AsyncClient(trust_env=False, follow_redirects=False) as client,
                client.stream(
                    "GET" if models else "POST",
                    url,
                    headers=headers,
                    json=payload,
                    extensions=extensions,
                    timeout=10,
                ) as response,
            ):
                code = response.status_code
                if code != 200:
                    errors = {
                        401: "authorization_failed",
                        403: "authorization_failed",
                        404: "models_unavailable" if models else "model_not_found",
                        405: "models_unavailable" if models else "incompatible_response",
                        429: "provider_rate_limited",
                    }
                    raise network.EndpointError(
                        errors.get(
                            code,
                            "server_unavailable" if code >= 500 else "incompatible_response",
                        )
                    )
                limit = MODELS_RESPONSE_MAX_BYTES if models else DIAGNOSTIC_RESPONSE_MAX_BYTES
                raw = bytearray()
                async for block in response.aiter_bytes(chunk_size=64 * 1024):
                    if len(raw) + len(block) > limit:
                        raise network.EndpointError("response_too_large")
                    raw.extend(block)
                body: JsonValue = json.loads(raw)
                if not isinstance(body, dict):
                    raise ValueError
                if models:
                    items = body["data"]
                    if not isinstance(items, list):
                        raise ValueError
                    names: set[str] = set()
                    for item in items:
                        if isinstance(item, dict):
                            name = item.get("id")
                            if isinstance(name, str) and 0 < len(name) <= 255:
                                names.add(name)
                    return {"models": sorted(names)[:1000]}
                choices = body["choices"]
                if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                    raise ValueError
                message = choices[0]["message"]
                if not isinstance(message, dict):
                    raise ValueError
                content = message["content"]
                if not isinstance(content, str) or not content.strip():
                    raise ValueError
    except network.EndpointError as exc:
        raise HTTPException(422, str(exc)) from None
    except (TimeoutError, httpx.TimeoutException):
        raise HTTPException(422, "provider_timeout") from None
    except httpx.HTTPError:
        raise HTTPException(422, "server_unavailable") from None
    except (ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(422, "incompatible_response") from None
    return {"ok": True, "latency_ms": int((time.monotonic() - started) * 1000)}
