"""Native language is the translation target and never one of the learning languages."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from glosano.core.config import get_settings
from glosano.core.db import session_scope
from glosano.modules.ai_translation import service as ai_service
from glosano.modules.ai_translation.provider import LLMCompletion
from glosano.modules.identity.models import UserProfile
from glosano.modules.identity.service import translation_target
from glosano.modules.lesson_library.models import Lesson
from glosano.modules.vocabulary.models import TokenItem
from tests._ai_helpers import provider_factory

PREFERENCES = {"daily_goal_minutes": 15, "daily_goal_reviews": 500}


async def register(client: AsyncClient) -> uuid.UUID:
    response = await client.post(
        "/auth/register",
        json={
            "display_name": "Native",
            "email": f"native-{uuid.uuid4()}@example.com",
            "password": "abcdefghij",
        },
    )
    assert response.status_code == 201
    csrf = client.cookies.get("glosano_csrf")
    assert csrf
    client.headers["X-CSRF-Token"] = csrf
    return uuid.UUID(response.json()["id"])


async def onboard(client: AsyncClient, **body: object) -> int:
    payload: dict[str, object] = {"ui_language": "en", "learning_languages": ["pt"], **body}
    response = await client.post("/me/onboarding", json=payload)
    return response.status_code


async def clear_native(user_id: uuid.UUID) -> None:
    async with session_scope() as session:
        await session.execute(
            update(UserProfile)
            .where(UserProfile.user_id == user_id)
            .values(native_language_code=None)
        )


async def test_onboarding_saves_native_language(client: AsyncClient):
    await register(client)
    assert (
        await onboard(client, ui_language="ru", learning_languages=["pt"], native_language="uk")
        == 200
    )
    me = (await client.get("/me")).json()
    assert me["native_language_code"] == "uk"
    assert me["preferred_translation_language_code"] == "uk"
    assert me["ui_language_code"] == "ru"
    assert me["needs_onboarding"] is False


async def test_onboarding_defaults_native_to_ui_language(client: AsyncClient):
    await register(client)
    assert await onboard(client, ui_language="en", learning_languages=["pt"]) == 200
    me = (await client.get("/me")).json()
    assert me["native_language_code"] == "en"
    assert me["preferred_translation_language_code"] == "en"


async def test_onboarding_rejects_native_in_learning(client: AsyncClient):
    await register(client)
    response = await client.post(
        "/me/onboarding",
        json={"ui_language": "en", "learning_languages": ["pt"], "native_language": "pt"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "native_language_is_learning"
    response = await client.post(
        "/me/onboarding", json={"ui_language": "en", "learning_languages": ["en"]}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "native_language_is_learning"
    me = (await client.get("/me")).json()
    assert me["native_language_code"] is None
    assert me["needs_onboarding"] is True


async def test_onboarding_rejects_explicit_native_among_learning(client: AsyncClient):
    await register(client)
    before = (await client.get("/me")).json()
    response = await client.post(
        "/me/onboarding",
        json={"ui_language": "en", "learning_languages": ["ru", "pt"], "native_language": "ru"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "native_language_is_learning"
    assert (await client.get("/me")).json() == before


async def test_onboarding_without_native_drops_ui_language_from_learning(client: AsyncClient):
    await register(client)
    assert await onboard(client, ui_language="en", learning_languages=["en", "pt"]) == 200
    me = (await client.get("/me")).json()
    assert me["learning_languages"] == ["pt"]
    assert me["native_language_code"] == "en"


async def test_onboarding_rejects_overlong_legacy_translation_language(client: AsyncClient):
    await register(client)
    assert await onboard(client, translation_language="x" * 17) == 422
    assert await onboard(client, translation_language="x" * 16) == 200


async def test_onboarding_native_language_drops_it_from_learning(client: AsyncClient):
    user_id = await register(client)
    assert await onboard(client, ui_language="en", learning_languages=["ru", "pt"]) == 200
    async with session_scope() as session:
        lesson = Lesson(owner_user_id=user_id, language_code="ru", title="T", raw_text="слово")
        session.add(lesson)
        session.add(
            TokenItem(
                user_id=user_id,
                language_code="ru",
                token_text="слово",
                status="tracked",
                confidence=1,
            )
        )
    await clear_native(user_id)
    assert (await client.get("/me")).json()["needs_onboarding"] is True

    response = await client.post(
        "/me/onboarding",
        json={"ui_language": "en", "learning_languages": ["pt"], "native_language": "ru"},
    )
    assert response.status_code == 200
    me = (await client.get("/me")).json()
    assert me["learning_languages"] == ["pt"]
    assert me["native_language_code"] == "ru"
    assert me["needs_onboarding"] is False
    async with session_scope() as session:
        lessons = await session.scalars(
            select(Lesson).where(Lesson.owner_user_id == user_id, Lesson.language_code == "ru")
        )
        assert len(lessons.all()) == 1
        tokens = await session.scalars(
            select(TokenItem).where(TokenItem.user_id == user_id, TokenItem.language_code == "ru")
        )
        assert len(tokens.all()) == 1


async def test_preferences_change_native_language(client: AsyncClient):
    await register(client)
    assert await onboard(client, ui_language="en", learning_languages=["pt"]) == 200
    response = await client.patch(
        "/me/preferences",
        json={
            "ui_language": "en",
            "learning_languages": ["pt"],
            "native_language": "it",
            **PREFERENCES,
        },
    )
    assert response.status_code == 200
    assert response.json()["native_language_code"] == "it"
    assert response.json()["preferred_translation_language_code"] == "it"

    response = await client.patch(
        "/me/preferences",
        json={
            "ui_language": "en",
            "learning_languages": ["pt"],
            "native_language": "pt",
            **PREFERENCES,
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "native_language_is_learning"

    response = await client.patch(
        "/me/preferences",
        json={
            "ui_language": "en",
            "learning_languages": ["pt"],
            "native_language": "en",
            **PREFERENCES,
        },
    )
    assert response.status_code == 200
    response = await client.patch(
        "/me/preferences",
        json={"ui_language": "en", "learning_languages": ["en"], **PREFERENCES},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "native_language_is_learning"
    me = (await client.get("/me")).json()
    assert me["learning_languages"] == ["pt"]
    assert me["native_language_code"] == "en"


async def test_add_learning_language_rejects_native(client: AsyncClient):
    await register(client)
    assert await onboard(client, learning_languages=["pt"], native_language="es") == 200
    response = await client.post("/me/learning-languages", json={"language_code": "es"})
    assert response.status_code == 400
    assert response.json()["detail"] == "native_language_is_learning"
    assert (await client.get("/me")).json()["learning_languages"] == ["pt"]


async def test_ui_language_change_keeps_translation_target(client: AsyncClient):
    user_id = await register(client)
    assert (
        await onboard(client, ui_language="en", learning_languages=["pt"], native_language="uk")
        == 200
    )
    response = await client.patch(
        "/me/preferences",
        json={"ui_language": "ru", "learning_languages": ["pt"], **PREFERENCES},
    )
    assert response.status_code == 200
    me = response.json()
    assert me["ui_language_code"] == "ru"
    assert me["native_language_code"] == "uk"
    assert me["preferred_translation_language_code"] == "uk"
    async with session_scope() as session:
        assert await translation_target(session, user_id) == "uk"


class _GoodProvider:
    async def complete(self, *, system: str, user: str) -> LLMCompletion:
        return LLMCompletion(text="later", input_tokens=1, output_tokens=1)


async def test_translation_target_requires_native(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(get_settings(), "llm_enabled", True)
    monkeypatch.setattr(ai_service, "_default_provider", provider_factory(_GoodProvider()))
    user_id = await register(client)
    assert await onboard(client, learning_languages=["pt"]) == 200
    await clear_native(user_id)
    response = await client.post(
        "/api/ai/translate",
        json={"surface_text": "mais", "context_text": "Até mais!", "target_language_code": "en"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "native_language_required"
