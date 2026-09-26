import pytest
from httpx import ASGITransport, AsyncClient

from glosano.main import create_app
from tests.api._reader_helpers import library_items


async def _register_and_onboard(c: AsyncClient, email: str, lang: str = "pt") -> str:
    r = await c.post(
        "/auth/register",
        json={"display_name": "T", "email": email, "password": "abcdefghij"},
    )
    assert r.status_code == 201
    csrf = c.cookies.get("glosano_csrf")
    assert csrf
    await c.post(
        "/me/onboarding",
        json={
            "ui_language": "en",
            "learning_languages": [lang],
            "translation_language": "en",
        },
        headers={"X-CSRF-Token": csrf},
    )
    return csrf


async def test_create_and_list_lesson(monkeypatch: pytest.MonkeyPatch) -> None:
    from glosano.core.db import session_scope
    from glosano.modules.lesson_library import service

    # In env=test the InMemoryBroker runs .kiq() inline, which would process the
    # lesson to `ready` before we can drive it ourselves. Stub the enqueue so the
    # lesson stays `processing`, then run the import explicitly below.
    async def _noop(lesson_id: object, job_id: object) -> None:
        return None

    monkeypatch.setattr("glosano.api.lessons.enqueue_lesson_import", _noop)

    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await _register_and_onboard(c, "lessons-create@example.com", lang="pt")

        r = await c.post(
            "/api/lessons",
            json={
                "title": "Olá mundo",
                "language_code": "pt",
                "raw_text": "Olá mundo. Como vai você?",
                "visibility": "private",
            },
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 202
        body = r.json()
        assert body["status"] == "processing"
        lesson_id = body["id"]

        import uuid as _uuid

        async with session_scope() as s:
            await service.process_lesson_import(s, _uuid.UUID(lesson_id))

        r = await c.get(f"/api/lessons/{lesson_id}")
        assert r.status_code == 200
        st = r.json()
        assert st["status"] == "ready"
        assert st["word_count"] == 5

        titles = [item["title"] for item in await library_items(c)]
        assert "Olá mundo" in titles


async def test_list_lessons_filters_by_language() -> None:
    """A lesson in pt is not returned when listing en."""
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await _register_and_onboard(c, "lessons-lang@example.com", lang="pt")
        await c.post(
            "/api/lessons",
            json={
                "title": "PT-only",
                "language_code": "pt",
                "raw_text": "x",
                "visibility": "private",
            },
            headers={"X-CSRF-Token": csrf},
        )

        titles = [item["title"] for item in await library_items(c, lang="en")]
        assert "PT-only" not in titles


async def test_create_requires_auth() -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post(
            "/api/lessons",
            json={
                "title": "X",
                "language_code": "pt",
                "raw_text": "x",
            },
        )
        assert r.status_code == 403  # CSRF blocks before auth check


async def test_old_list_endpoint_is_gone() -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        await _register_and_onboard(c, "lessons-old-list@example.com")
        r = await c.get("/api/lessons?lang=pt")
        assert r.status_code == 405


async def test_create_validates_language() -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await _register_and_onboard(c, "lessons-bad-lang@example.com")
        r = await c.post(
            "/api/lessons",
            json={
                "title": "X",
                "language_code": "xx",  # not supported
                "raw_text": "x",
            },
            headers={"X-CSRF-Token": csrf},
        )
        assert r.status_code == 422


async def test_list_search_by_title() -> None:
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        csrf = await _register_and_onboard(c, "lessons-search@example.com", lang="pt")
        await c.post(
            "/api/lessons",
            json={
                "title": "FindMe Olá",
                "language_code": "pt",
                "raw_text": "x",
            },
            headers={"X-CSRF-Token": csrf},
        )

        titles = [item["title"] for item in await library_items(c, q="FindMe")]
        assert any("FindMe" in t for t in titles)
