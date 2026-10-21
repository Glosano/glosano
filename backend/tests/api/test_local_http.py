"""Release local HTTP mode works without browser-specific Secure-cookie exceptions."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from glosano.core.config import get_settings
from glosano.main import create_app


@pytest.mark.parametrize(
    ("local_http", "origin"),
    [
        (True, "http://localhost"),
        (True, "http://127.0.0.1"),
        (False, "https://glosano.example.com"),
    ],
)
async def test_login_and_csrf_in_local_and_server_modes(
    monkeypatch: pytest.MonkeyPatch, local_http: bool, origin: str
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "env", "prod")
    monkeypatch.setattr(settings, "local_http", local_http)
    monkeypatch.setattr(settings, "allow_public_registration", True)
    email = f"local-{uuid.uuid4().hex}@example.com"
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url=origin) as client:
        registered = await client.post(
            "/auth/register",
            json={"email": email, "display_name": "Local", "password": "local-password-123"},
        )
        assert registered.status_code == 201, registered.text
        for cookie in client.cookies.jar:
            assert cookie.secure is (not local_http)
        assert (await client.get("/me")).status_code == 200
        client.cookies.clear()
        logged_in = await client.post(
            "/auth/login",
            json={"email": email, "password": "local-password-123", "remember_me": True},
        )
        assert logged_in.status_code == 200, logged_in.text
        assert (await client.get("/me")).json()["email"] == email
        cookies = {cookie.name: cookie for cookie in client.cookies.jar}
        assert set(cookies) == {"glosano_session", "glosano_csrf"}
        assert cookies["glosano_session"].has_nonstandard_attr("HttpOnly")
        assert all(cookie.secure is (not local_http) for cookie in cookies.values())
        body = {"ui_language": "en", "native_language": "en", "learning_languages": ["pt"]}
        assert (await client.post("/me/onboarding", json=body)).status_code == 403
        client.headers["X-CSRF-Token"] = client.cookies["glosano_csrf"]
        assert (await client.post("/me/onboarding", json=body)).status_code == 200
        assert (await client.post("/auth/logout")).status_code == 200
        assert (await client.get("/me")).status_code == 401


@pytest.mark.parametrize("host", ["example.com", "localhost.evil.example", "192.168.1.10"])
async def test_local_http_rejects_non_loopback_hosts(
    monkeypatch: pytest.MonkeyPatch, host: str
) -> None:
    monkeypatch.setattr(get_settings(), "local_http", True)
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url=f"http://{host}"
    ) as client:
        assert (await client.get("/health")).status_code == 400
