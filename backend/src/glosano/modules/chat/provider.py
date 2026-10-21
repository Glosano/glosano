"""Chat Completions transport. Errors contain codes, never bodies or credentials."""

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable

import httpx

from glosano.core.config import Settings
from glosano.modules.admin import network
from glosano.modules.admin.settings import effective_settings


class ProviderError(Exception):
    """Only safe, fixed internal codes may be passed here."""


class ChatProvider:
    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        settings: Settings | None = None,
        active: Callable[[], Awaitable[bool]] | None = None,
    ):
        self.client = client
        self.active = active
        self.settings = settings

    async def stream(self, messages: list[dict[str, str]]) -> AsyncIterator[str]:
        streaming = True
        emitted = False
        settings = self.settings or await effective_settings()
        for attempt in range(3):
            current = await effective_settings()
            if not current.llm_enabled:
                raise ProviderError("ai_disabled")
            if current.llm_revision != settings.llm_revision:
                raise ProviderError("configuration_changed")
            if not settings.llm_enabled:
                raise ProviderError("ai_disabled")
            if self.active is not None and not await self.active():
                raise ProviderError("generation_stopped")
            headers = (
                {"Authorization": f"Bearer {settings.llm_api_key}"} if settings.llm_api_key else {}
            )
            retry = False
            try:
                url = settings.llm_base_url.rstrip("/") + "/chat/completions"
                url, host_headers, extensions = await network.target(url)
                headers.update(host_headers)
                async with self.client.stream(
                    "POST",
                    url,
                    extensions=extensions,
                    follow_redirects=False,
                    headers=headers,
                    json={
                        "model": settings.llm_model,
                        "messages": messages,
                        "max_tokens": settings.chat_answer_max_tokens,
                        "stream": streaming,
                    },
                    timeout=settings.llm_timeout_seconds,
                ) as response:
                    if response.status_code in (400, 405, 415, 422) and streaming and not emitted:
                        streaming = False
                        continue
                    if response.status_code >= 500:
                        retry = True
                    elif response.status_code >= 300:
                        raise ProviderError("provider_http_error")
                    elif "text/event-stream" not in response.headers.get("content-type", ""):
                        raw = b""
                        async for block in response.aiter_bytes():
                            raw += block
                            if len(raw) > 262144:
                                raise ProviderError("provider_output_limit")
                        choice = json.loads(raw)["choices"][0]
                        if choice.get("finish_reason") == "length":
                            raise ProviderError("provider_output_limit")
                        content = choice["message"]["content"]
                        if not isinstance(content, str):
                            raise ValueError
                        emitted = True
                        yield content
                        return
                    else:
                        finished = False
                        async for line in response.aiter_lines():
                            if len(line) > 262144:
                                raise ProviderError("provider_output_limit")
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if data == "[DONE]":
                                finished = True
                                break
                            obj = json.loads(data)
                            choices = obj.get("choices", [])
                            if not choices:
                                continue
                            choice = choices[0]
                            if choice.get("finish_reason") == "length":
                                raise ProviderError("provider_output_limit")
                            content = choice.get("delta", {}).get("content")
                            if content:
                                if not isinstance(content, str):
                                    raise ValueError
                                emitted = True
                                yield content
                        if not finished:
                            raise ProviderError("provider_interrupted")
                        return
            except network.EndpointError:
                raise ProviderError("invalid_endpoint") from None
            except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError):
                retry = True
            except (ValueError, KeyError, IndexError, TypeError):
                raise ProviderError("provider_invalid_response") from None
            if retry:
                if emitted or attempt == 2:
                    raise ProviderError("provider_unavailable") from None
                await asyncio.sleep(0.25 * 2**attempt)
        raise ProviderError("provider_unavailable")
