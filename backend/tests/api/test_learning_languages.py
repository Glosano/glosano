"""Adding learning languages preserves the profile and persists the current language."""

import pytest
from httpx import ASGITransport, AsyncClient

from glosano.main import create_app
from tests.api.test_me_settings import register

CODES = ["en", "ru", "pt", "es", "fr", "de", "zh-Hans", "ja", "ar", "hi"]


async def test_add_language_is_persistent_idempotent_and_preserves_profile(client: AsyncClient):
    await register(client)
    await client.patch(
        "/me/preferences",
        json={
            "ui_language": "ru",
            "learning_languages": ["pt"],
            "daily_goal_minutes": 32,
            "daily_goal_reviews": 123,
        },
    )
    before = (await client.get("/me")).json()
    for _ in range(2):
        response = await client.post("/me/learning-languages", json={"language_code": "zh-Hans"})
        assert response.status_code == 200
        result = response.json()
        assert set(result["learning_languages"]) == {"pt", "zh-Hans"}
        assert len(result["learning_languages"]) == 2
        assert result["last_learning_language_code"] == "zh-Hans"
        for key in before.keys() - {"learning_languages", "last_learning_language_code"}:
            assert result[key] == before[key]
        assert (await client.get("/me")).json() == result
    assert (
        await client.patch("/me/last-language", json={"language_code": "zh-Hans"})
    ).status_code == 200


@pytest.mark.parametrize("code", CODES)
async def test_catalog_available_for_preferences_and_add(client: AsyncClient, code: str):
    await register(client)
    response = await client.patch(
        "/me/preferences",
        json={
            "ui_language": "en",
            "learning_languages": [code],
            "daily_goal_minutes": 15,
            "daily_goal_reviews": 500,
        },
    )
    assert response.status_code == 200
    assert (
        await client.post("/me/learning-languages", json={"language_code": code})
    ).status_code == 200


async def test_add_rejects_invalid_codes_and_missing_csrf_without_mutation(client: AsyncClient):
    await register(client)
    before = (await client.get("/me")).json()
    for code in ["xx", "zh", "zh-Hant", "", "EN"]:
        assert (
            await client.post("/me/learning-languages", json={"language_code": code})
        ).status_code == 422
    del client.headers["X-CSRF-Token"]
    assert (
        await client.post("/me/learning-languages", json={"language_code": "ja"})
    ).status_code == 403
    assert (await client.get("/me")).json() == before


async def test_add_requires_auth(client: AsyncClient):
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as anonymous:
        anonymous.cookies.set("glosano_csrf", "test-csrf")
        anonymous.headers["X-CSRF-Token"] = "test-csrf"
        assert (
            await anonymous.post("/me/learning-languages", json={"language_code": "en"})
        ).status_code == 401


async def test_concurrent_additions_preserve_both_languages(client: AsyncClient):
    import asyncio

    await register(client)
    results = await asyncio.gather(
        *[
            client.post("/me/learning-languages", json={"language_code": code})
            for code in ["zh-Hans", "ja", "zh-Hans"]
        ]
    )
    assert all(result.status_code == 200 for result in results)
    profile = (await client.get("/me")).json()
    assert set(profile["learning_languages"]) == {"zh-Hans", "ja"}
    assert len(profile["learning_languages"]) == 2
    assert profile["last_learning_language_code"] in profile["learning_languages"]
