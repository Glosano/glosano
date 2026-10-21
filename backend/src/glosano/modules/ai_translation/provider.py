"""The one OpenAI-compatible LLM adapter (ADR-0003). Only HTTP-facing layer.

Retry discipline: up to 3 attempts, exponential backoff, ONLY on transport
errors and 5xx. Provider 4xx (bad key/model) fails immediately. Privacy:
never log message contents — status codes and attempt counts only.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Protocol

import httpx
from loguru import logger
from pydantic import JsonValue

from glosano.core.config import Settings
from glosano.modules.admin import network
from glosano.modules.admin.settings import check_current

_MAX_ATTEMPTS = 3
_BACKOFF_BASE_SECONDS = 0.5


class ProviderUnavailable(Exception):  # noqa: N818 -- name fixed by ADR-0003 interface contract
    """Network failure, timeout or 5xx after all retries."""


class ProviderRejected(Exception):  # noqa: N818 -- name fixed by ADR-0003 interface contract
    """Non-retriable provider response (4xx or malformed body)."""


@dataclass(frozen=True)
class LLMCompletion:
    text: str
    input_tokens: int | None
    output_tokens: int | None


class LLMProvider(Protocol):
    async def complete(self, *, system: str, user: str, max_tokens: int = 100) -> LLMCompletion: ...


class OpenAICompatibleProvider:
    def __init__(self, settings: Settings, *, client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        self._client = client

    async def complete(self, *, system: str, user: str, max_tokens: int = 100) -> LLMCompletion:
        s = self._settings
        payload = {
            "model": s.llm_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "max_tokens": max_tokens,
        }
        headers: dict[str, str] = {}
        if s.llm_api_key:
            headers["Authorization"] = f"Bearer {s.llm_api_key}"
        url = f"{s.llm_base_url.rstrip('/')}/chat/completions"

        own_client = self._client is None
        client = self._client or httpx.AsyncClient(
            timeout=float(s.llm_timeout_seconds), trust_env=False, follow_redirects=False
        )
        try:
            for attempt in range(1, _MAX_ATTEMPTS + 1):
                if s.llm_revision:
                    await check_current(s)
                try:
                    target_url: str | httpx.URL = url
                    extensions: dict[str, object] = {}
                    request_headers = dict(headers)
                    if own_client:
                        target_url, host_headers, extensions = await network.target(url)
                        request_headers.update(host_headers)
                    async with client.stream(
                        "POST",
                        target_url,
                        json=payload,
                        headers=request_headers,
                        extensions=extensions,
                        follow_redirects=False,
                    ) as stream:
                        raw = b""
                        async for block in stream.aiter_bytes():
                            raw += block
                            if len(raw) > 262144:
                                raise ProviderRejected("provider_output_limit")
                        response = httpx.Response(stream.status_code, content=raw)
                except network.EndpointError:
                    raise ProviderRejected("invalid_endpoint") from None
                except httpx.TransportError as exc:
                    logger.warning(
                        "llm attempt {}/{}: {}", attempt, _MAX_ATTEMPTS, type(exc).__name__
                    )
                else:
                    if 200 <= response.status_code < 300:
                        return _parse_completion(response)
                    if response.status_code < 500:
                        raise ProviderRejected(f"provider returned {response.status_code}")
                    logger.warning(
                        "llm attempt {}/{}: HTTP {}", attempt, _MAX_ATTEMPTS, response.status_code
                    )
                if attempt < _MAX_ATTEMPTS:
                    await asyncio.sleep(_BACKOFF_BASE_SECONDS * 2 ** (attempt - 1))
            raise ProviderUnavailable("provider_unavailable") from None
        finally:
            if own_client:
                await client.aclose()


def _parse_completion(response: httpx.Response) -> LLMCompletion:
    try:
        body: JsonValue = response.json()
        if not isinstance(body, dict):
            raise ValueError("expected an object")
        choices = body["choices"]
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise ValueError("expected choices")
        message = choices[0]["message"]
        if not isinstance(message, dict):
            raise ValueError("expected a message")
        text = message["content"]
        if text is None:
            text = ""
        if not isinstance(text, str):
            raise ValueError("expected text content")
        usage = body.get("usage")
        if usage is None:
            usage = {}
        if not isinstance(usage, dict):
            raise ValueError("expected usage object")
        input_tokens = usage.get("prompt_tokens")
        output_tokens = usage.get("completion_tokens")
        for count in (input_tokens, output_tokens):
            if count is not None and (not isinstance(count, int) or isinstance(count, bool)):
                raise ValueError("expected integer token count")
        # Narrow each optional count for the dataclass contract.
        assert input_tokens is None or isinstance(input_tokens, int)
        assert output_tokens is None or isinstance(output_tokens, int)
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise ProviderRejected("malformed provider response") from exc
    return LLMCompletion(text=text, input_tokens=input_tokens, output_tokens=output_tokens)
