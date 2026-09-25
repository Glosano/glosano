"""Grammar suggestions and durable, user-owned tag provenance."""

import uuid

import pytest
from httpx import AsyncClient

from glosano.core.config import get_settings
from glosano.modules.ai_translation import service
from glosano.modules.ai_translation.provider import LLMCompletion


async def register(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/register",
        json={
            "display_name": "Tags",
            "email": f"{uuid.uuid4()}@example.com",
            "password": "abcdefghij",
        },
    )
    assert response.status_code == 201
    client.headers["X-CSRF-Token"] = client.cookies["glosano_csrf"]
    await client.post(
        "/me/onboarding",
        json={
            "ui_language": "ru",
            "learning_languages": ["pt"],
            "translation_language": "ru",
        },
    )


async def test_tag_sources_survive_lookup_and_ai_cannot_replace_manual(client: AsyncClient):
    await register(client)
    response = await client.post(
        "/api/vocabulary/items",
        json={
            "kind": "token",
            "language_code": "pt",
            "text": "ecoavam",
            "status": "tracked",
            "confidence": 1,
        },
    )
    item_id = response.json()["item_id"]
    url = f"/api/vocabulary/items/token/{item_id}/tags"
    assert (await client.post(url, json={"tag_name": "ecoar"})).status_code == 200
    for _ in range(2):
        response = await client.post(
            url + "/batch",
            json={
                "tags": ["Глагол", "ecoar", "pretérito imperfeito"],
                "source_type": "ai",
            },
        )
        assert response.status_code == 200
    result = (
        await client.get(
            "/api/vocabulary/lookup",
            params={
                "lang": "pt",
                "target": "ru",
                "text": "ecoavam",
            },
        )
    ).json()
    assert set(result["tags"]) == {"Глагол", "ecoar", "pretérito imperfeito"}
    assert set(result["ai_tags"]) == {"Глагол", "pretérito imperfeito"}
    listing = (await client.get("/api/vocabulary", params={"lang": "pt", "target": "ru"})).json()
    assert set(listing["items"][0]["ai_tags"]) == {"Глагол", "pretérito imperfeito"}
    assert (await client.delete(url + "/ecoar")).status_code == 200
    result = (
        await client.get(
            "/api/vocabulary/lookup",
            params={
                "lang": "pt",
                "target": "ru",
                "text": "ecoavam",
            },
        )
    ).json()
    assert "ecoar" not in result["tags"]
    await register(client)
    assert (await client.post(url + "/batch", json={"tags": ["foreign"]})).status_code == 404


@pytest.mark.parametrize("tags", [[" "], ["x" * 65], ["ok", " "]])
async def test_invalid_tag_batch_is_rejected(client: AsyncClient, tags: list[str]):
    await register(client)
    response = await client.post(
        f"/api/vocabulary/items/token/{uuid.uuid4()}/tags/batch", json={"tags": tags}
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        (
            '{"part_of_speech":"verb","base_form":"ecoar","verb_tense":"pretérito imperfeito"}',
            ["Глагол", "ecoar", "pretérito imperfeito"],
        ),
        (
            '{"part_of_speech":"noun","base_form":"book","verb_tense":"past"}',
            ["Существительное", "book"],
        ),
        ('{"part_of_speech":null,"base_form":null,"verb_tense":null}', []),
    ],
)
async def test_grammar_suggestions_use_context(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, answer: str, expected: list[str]
) -> None:
    await register(client)
    monkeypatch.setattr(get_settings(), "llm_enabled", True)

    class Provider:
        async def complete(self, *, system: str, user: str, max_tokens: int = 100) -> LLMCompletion:
            assert "ecoavam" in user and "Os sons ecoavam." in user
            assert "Portuguese" in user
            return LLMCompletion(text=answer, input_tokens=10, output_tokens=20)

    monkeypatch.setattr(service, "_default_provider", lambda: Provider())
    response = await client.post(
        "/api/ai/word-tags",
        json={
            "surface_text": "ecoavam",
            "context_text": "Os sons ecoavam.",
            "language_code": "pt",
        },
    )
    assert response.status_code == 200
    assert response.json()["tags"] == expected


async def test_grammar_disabled_never_calls_provider(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await register(client)
    monkeypatch.setattr(get_settings(), "llm_enabled", False)
    assert (await client.get("/me")).json()["ai_enabled"] is False

    def forbidden():
        pytest.fail("disabled AI must not initialize a provider")

    monkeypatch.setattr(service, "_default_provider", forbidden)
    response = await client.post(
        "/api/ai/word-tags",
        json={
            "surface_text": "ecoavam",
            "context_text": "Os sons ecoavam.",
            "language_code": "pt",
        },
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "ai_disabled"


@pytest.mark.parametrize(
    "answer", ["not JSON", '{"base_form":["x"]}', '{"base_form":"' + "x" * 65 + '"}']
)
async def test_invalid_grammar_is_not_returned_as_tags(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, answer: str
) -> None:
    await register(client)
    monkeypatch.setattr(get_settings(), "llm_enabled", True)

    class Provider:
        async def complete(self, *, system: str, user: str, max_tokens: int = 100) -> LLMCompletion:
            return LLMCompletion(text=answer, input_tokens=1, output_tokens=1)

    monkeypatch.setattr(service, "_default_provider", lambda: Provider())
    response = await client.post(
        "/api/ai/word-tags",
        json={
            "surface_text": "word",
            "context_text": "word",
            "language_code": "en",
        },
    )
    assert response.status_code == 502
