"""Settings contracts, target language consistency and session safety."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from glosano.core.db import session_scope
from glosano.main import create_app
from glosano.modules.identity.repo import UserRepo


async def register(client: AsyncClient) -> tuple[str, str]:
    email = f"settings-{uuid.uuid4()}@example.com"
    response = await client.post(
        "/auth/register",
        json={
            "display_name": "Settings",
            "email": email,
            "password": "abcdefghij",
        },
    )
    assert response.status_code == 201
    csrf = client.cookies.get("glosano_csrf")
    assert csrf
    client.headers["X-CSRF-Token"] = csrf
    return response.json()["id"], email


async def test_profile_updates_trimmed_name_and_returns_complete_me(client: AsyncClient):
    await register(client)
    response = await client.patch("/me/profile", json={"display_name": "  New Name  "})
    assert response.status_code == 200
    me = response.json()
    assert me["display_name"] == "New Name"
    assert me["daily_goal_reviews"] == 500
    assert me["daily_goal_minutes"] == 15
    assert me["preferred_translation_language_code"] == me["ui_language_code"] == "en"
    assert (await client.get("/me")).json() == me
    assert (await client.patch("/me/profile", json={"display_name": "   "})).status_code == 422
    assert (await client.patch("/me/profile", json={"display_name": "x" * 81})).status_code == 422


async def test_preferences_replace_languages_and_synchronize_target(client: AsyncClient):
    user_id, _ = await register(client)
    await client.post(
        "/me/onboarding",
        json={
            "ui_language": "ru",
            "learning_languages": ["en", "pt"],
            "translation_language": "pt",
        },
    )
    assert (await client.get("/me")).json()["preferred_translation_language_code"] == "ru"
    response = await client.patch(
        "/me/preferences",
        json={
            "ui_language": "en",
            "learning_languages": ["pt", "pt"],
            "daily_goal_minutes": 25,
            "daily_goal_reviews": 500,
        },
    )
    assert response.status_code == 200
    me = response.json()
    assert me["learning_languages"] == ["pt"]
    assert me["last_learning_language_code"] == "pt"
    assert me["preferred_translation_language_code"] == me["ui_language_code"] == "en"
    assert me["daily_goal_minutes"] == 25
    async with session_scope() as session:
        user = await UserRepo(session).get_by_id_full(uuid.UUID(user_id))
        assert user and user.settings.preferred_translation_language_code == "en"


@pytest.mark.parametrize(
    "override",
    [
        {"ui_language": "pt"},
        {"learning_languages": []},
        {"learning_languages": ["xx"]},
        {"daily_goal_minutes": 0},
        {"daily_goal_minutes": 1441},
        {"daily_goal_reviews": 0},
        {"daily_goal_reviews": 10001},
        {"daily_goal_reviews": 1.5},
    ],
)
async def test_preferences_reject_invalid_values_atomically(
    client: AsyncClient, override: dict[str, object]
):
    await register(client)
    before = (await client.get("/me")).json()
    response = await client.patch(
        "/me/preferences",
        json={
            "ui_language": "en",
            "learning_languages": ["pt"],
            "daily_goal_minutes": 15,
            "daily_goal_reviews": 500,
            **override,
        },
    )
    assert response.status_code == 422
    assert (await client.get("/me")).json() == before


async def test_password_change_checks_current_revokes_others_retains_current(client: AsyncClient):
    _, email = await register(client)
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as other:
        assert (
            await other.post("/auth/login", json={"email": email, "password": "abcdefghij"})
        ).status_code == 200
        assert (
            await client.post(
                "/me/password",
                json={
                    "current_password": "wrong",
                    "new_password": "klmnopqrst",
                },
            )
        ).status_code == 401
        assert (await other.get("/me")).status_code == 200
        for password in ["short", "x" * 129]:
            assert (
                await client.post(
                    "/me/password",
                    json={
                        "current_password": "abcdefghij",
                        "new_password": password,
                    },
                )
            ).status_code == 422
        response = await client.post(
            "/me/password",
            json={
                "current_password": "abcdefghij",
                "new_password": "klmnopqrst",
            },
        )
        assert response.status_code == 200 and response.json() == {"ok": True}
        assert (await client.get("/me")).status_code == 200
        assert (await other.get("/me")).status_code == 401
        assert (
            await other.post("/auth/login", json={"email": email, "password": "abcdefghij"})
        ).status_code == 401
        assert (
            await other.post("/auth/login", json={"email": email, "password": "klmnopqrst"})
        ).status_code == 200


async def test_delete_after_eager_loading_identity_relations(client: AsyncClient):
    user_id, _ = await register(client)
    async with session_scope() as session:
        repo = UserRepo(session)
        user = await repo.get_by_id_full(uuid.UUID(user_id))
        assert user and user.profile and user.settings
        await repo.hard_delete(uuid.UUID(user_id))
        await session.flush()
    assert (await client.get("/me")).status_code == 401
