"""Provider transport never replays partial output or exposes raw payloads."""

import json
from typing import Any

import httpx
import pytest

from glosano.core.config import get_settings


@pytest.fixture(autouse=True)
def enabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GLOSANO_LLM_ENABLED", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_stream_and_nonstream_fallback():
    from glosano.modules.chat.provider import ChatProvider

    calls: list[dict[str, Any]] = []

    def endpoint(request: httpx.Request):
        body = json.loads(request.content)
        calls.append(body)
        if body["stream"]:
            return httpx.Response(400)
        return httpx.Response(200, json={"choices": [{"message": {"content": "hello"}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(endpoint)) as client:
        chunks = [c async for c in ChatProvider(client).stream([{"role": "user", "content": "x"}])]
    assert chunks == ["hello"]
    assert [c["stream"] for c in calls] == [True, False]
    assert calls[0]["max_tokens"] == 1500


async def test_disabled_between_retries(monkeypatch: pytest.MonkeyPatch):
    from glosano.modules.chat.provider import ChatProvider, ProviderError

    calls: list[httpx.Request] = []

    def endpoint(request: httpx.Request):
        calls.append(request)
        monkeypatch.setenv("GLOSANO_LLM_ENABLED", "false")
        get_settings.cache_clear()
        return httpx.Response(500, text="PRIVATE SECRET")

    async with httpx.AsyncClient(transport=httpx.MockTransport(endpoint)) as client:
        with pytest.raises(ProviderError, match="ai_disabled"):
            _ = [c async for c in ChatProvider(client).stream([])]
    assert len(calls) == 1


async def test_invalid_sse_frame_is_rejected_without_exposing_provider_payload():
    from glosano.modules.chat.provider import ChatProvider, ProviderError

    calls: list[httpx.Request] = []

    def endpoint(request: httpx.Request):
        calls.append(request)
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=b"data: PRIVATE INVALID JSON\n\n",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(endpoint)) as client:
        with pytest.raises(ProviderError, match="provider_invalid_response") as caught:
            _ = [c async for c in ChatProvider(client).stream([])]
    assert str(caught.value) == "provider_invalid_response"
    assert len(calls) == 1


async def test_retry_checks_generation_fence_before_another_http_call():
    from glosano.modules.chat.provider import ChatProvider, ProviderError

    calls: list[httpx.Request] = []

    async def active() -> bool:
        return not calls

    def endpoint(request: httpx.Request):
        calls.append(request)
        return httpx.Response(503)

    async with httpx.AsyncClient(transport=httpx.MockTransport(endpoint)) as client:
        with pytest.raises(ProviderError, match="generation_stopped"):
            _ = [c async for c in ChatProvider(client, active=active).stream([])]
    assert len(calls) == 1


@pytest.mark.parametrize("after_partial", [False, True])
async def test_timeouts_retry_only_before_output(after_partial: bool):
    from glosano.modules.chat.provider import ChatProvider, ProviderError

    calls: list[httpx.Request] = []

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            if after_partial:
                yield b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
            raise httpx.ReadTimeout("PRIVATE BODY")

    def endpoint(request: httpx.Request):
        calls.append(request)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=Stream())

    output: list[str] = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(endpoint)) as client:
        with pytest.raises(ProviderError, match="provider_unavailable") as caught:
            async for chunk in ChatProvider(client).stream([]):
                output.append(chunk)
    assert len(calls) == (1 if after_partial else 3)
    assert output == (["partial"] if after_partial else [])
    assert "PRIVATE" not in str(caught.value)


async def test_normal_sse_stream():
    from glosano.modules.chat.provider import ChatProvider

    content = (
        b'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'
        b'data: {"choices":[{"delta":{"content":" world"}}]}\n\n'
        b"data: [DONE]\n\n"
    )

    def endpoint(request: httpx.Request):
        return httpx.Response(200, content=content, headers={"content-type": "text/event-stream"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(endpoint)) as client:
        assert [c async for c in ChatProvider(client).stream([])] == ["hello", " world"]


@pytest.mark.parametrize("key", ["", "scripted-test-key"])
async def test_optional_api_key_header(monkeypatch: pytest.MonkeyPatch, key: str):
    from glosano.modules.chat.provider import ChatProvider

    monkeypatch.setenv("GLOSANO_LLM_API_KEY", key)
    get_settings.cache_clear()
    headers: list[httpx.Headers] = []

    def endpoint(request: httpx.Request):
        headers.append(request.headers)
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "hello"}, "finish_reason": "stop"}]}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(endpoint)) as client:
        assert [c async for c in ChatProvider(client).stream([])] == ["hello"]
    assert len(headers) == 1
    if key:
        assert headers[0]["authorization"] == f"Bearer {key}"
    else:
        assert "authorization" not in headers[0]


async def test_nonstream_length_never_yields_truncated_text():
    from glosano.modules.chat.provider import ChatProvider, ProviderError

    calls: list[bool] = []

    def endpoint(request: httpx.Request):
        streaming = json.loads(request.content)["stream"]
        calls.append(streaming)
        if streaming:
            return httpx.Response(400)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {"content": "Valid but truncated"},
                        "finish_reason": "length",
                    }
                ]
            },
        )

    chunks: list[str] = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(endpoint)) as client:
        with pytest.raises(ProviderError, match="provider_output_limit"):
            async for chunk in ChatProvider(client).stream([]):
                chunks.append(chunk)
    assert chunks == []
    assert calls == [True, False]
