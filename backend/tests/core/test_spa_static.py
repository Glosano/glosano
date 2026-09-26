"""SPA fallback when FastAPI serves the built frontend (ADR-0006, FLQ-37)."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from glosano.core.config import get_settings

INDEX = "<!doctype html><title>spa-index</title>"


@pytest.fixture
def static_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text(INDEX)
    (tmp_path / "assets" / "app.js").write_text("console.log('app')")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    monkeypatch.setenv("GLOSANO_STATIC_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    monkeypatch.delenv("GLOSANO_STATIC_DIR")
    get_settings.cache_clear()


@pytest.fixture
async def spa_client(static_dir: Path) -> AsyncIterator[AsyncClient]:
    from glosano.main import create_app

    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.parametrize(
    "path",
    ["/", "/learn/pt/library", "/learn/pt/lessons/0b7c1f5e-8a61-4c5e-9d0a-1f2e3d4c5b6a", "/meadow"],
)
async def test_client_routes_get_the_index(spa_client: AsyncClient, path: str) -> None:
    r = await spa_client.get(path)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert "spa-index" in r.text


async def test_head_on_a_client_route_gets_the_index(spa_client: AsyncClient) -> None:
    r = await spa_client.head("/learn/pt/library")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")


async def test_existing_files_are_served_as_is(spa_client: AsyncClient) -> None:
    r = await spa_client.get("/assets/app.js")
    assert r.status_code == 200
    assert r.text == "console.log('app')"
    assert (await spa_client.get("/favicon.svg")).text == "<svg/>"


@pytest.mark.parametrize(
    "path",
    [
        "/api/does-not-exist",
        "/api/lessons/0b7c1f5e-8a61-4c5e-9d0a-1f2e3d4c5b6a/nope",
        "/auth/nope",
        "/me/nope",
        "/health/nope",
        "/assets/missing.js",
        "/learn/pt/missing.png",
    ],
)
async def test_backend_paths_and_missing_files_stay_json_404(
    spa_client: AsyncClient, path: str
) -> None:
    r = await spa_client.get(path)
    assert r.status_code == 404
    assert r.json() == {"detail": "Not Found"}


async def test_api_routes_still_answer(spa_client: AsyncClient) -> None:
    r = await spa_client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
