"""External dictionaries API: per-pair lists, layouts and custom dictionaries (FLQ-46)."""

from __future__ import annotations

import uuid
from typing import Any

from httpx import ASGITransport, AsyncClient

from glosano.main import create_app
from tests.api._reader_helpers import register_and_onboard

PAIR = {"src": "pt", "dst": "ru"}


def _custom_body(
    name: str = "My dict", template: str = "https://example.com/?q={word}"
) -> dict[str, Any]:
    return {
        "name": name,
        "url_template": template,
        "all_languages": False,
        "source_language_code": "pt",
        "target_language_code": "ru",
    }


async def _create(c: AsyncClient, csrf: str, **kwargs: Any) -> dict[str, Any]:
    r = await c.post(
        "/api/dictionary/external/custom",
        json=_custom_body(**kwargs),
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_list_requires_auth(client: AsyncClient) -> None:
    r = await client.get("/api/dictionary/external", params=PAIR)
    assert r.status_code == 401


async def test_default_list_for_pt_ru(client: AsyncClient) -> None:
    await register_and_onboard(client, f"ext-default-{uuid.uuid4().hex}@example.com")
    r = await client.get("/api/dictionary/external", params=PAIR)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [d["name"] for d in body["visible"]] == [
        "Reverso Context",
        "Google Translate",
        "DeepL",
        "Wiktionary",
    ]
    assert body["visible"][0]["url_template"] == (
        "https://context.reverso.net/translation/portuguese-russian/{word}"
    )
    assert body["available"] == []


async def test_bad_language_code_rejected(client: AsyncClient) -> None:
    await register_and_onboard(client, f"ext-badcode-{uuid.uuid4().hex}@example.com")
    r = await client.get("/api/dictionary/external", params={"src": "xx", "dst": "ru"})
    assert r.status_code == 422


async def test_create_layout_roundtrip(client: AsyncClient) -> None:
    csrf = await register_and_onboard(client, f"ext-layout-{uuid.uuid4().hex}@example.com")
    custom = await _create(client, csrf)
    assert custom["kind"] == "custom"
    assert custom["ref"] == f"custom:{custom['custom_id']}"

    listed = (await client.get("/api/dictionary/external", params=PAIR)).json()
    assert custom["ref"] in [d["ref"] for d in listed["visible"]]

    wanted = [custom["ref"], "builtin:wiktionary"]
    r = await client.put(
        "/api/dictionary/external/layout",
        params=PAIR,
        json={"visible": wanted},
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 200, r.text
    assert [d["ref"] for d in r.json()["visible"]] == wanted

    body = (await client.get("/api/dictionary/external", params=PAIR)).json()
    assert [d["ref"] for d in body["visible"]] == wanted
    assert body["visible"][0]["name"] == "My dict"
    assert {d["ref"] for d in body["available"]} == {
        "builtin:reverso",
        "builtin:google",
        "builtin:deepl",
    }


async def test_update_and_delete_custom(client: AsyncClient) -> None:
    csrf = await register_and_onboard(client, f"ext-upd-{uuid.uuid4().hex}@example.com")
    custom = await _create(client, csrf)
    headers = {"X-CSRF-Token": csrf}
    url = f"/api/dictionary/external/custom/{custom['custom_id']}"

    r = await client.patch(
        url, json=_custom_body(name="Renamed", template="https://x.example/{word}"), headers=headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Renamed"
    assert r.json()["url_template"] == "https://x.example/{word}"

    assert (await client.delete(url, headers=headers)).status_code == 204
    assert (await client.delete(url, headers=headers)).status_code == 404
    listed = (await client.get("/api/dictionary/external", params=PAIR)).json()
    assert custom["ref"] not in [d["ref"] for d in listed["visible"] + listed["available"]]


async def test_invalid_template_returns_code(client: AsyncClient) -> None:
    csrf = await register_and_onboard(client, f"ext-invalid-{uuid.uuid4().hex}@example.com")
    r = await client.post(
        "/api/dictionary/external/custom",
        json=_custom_body(template="javascript:alert(1)//{word}"),
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "invalid_scheme"


async def test_name_too_long_rejected(client: AsyncClient) -> None:
    csrf = await register_and_onboard(client, f"ext-long-{uuid.uuid4().hex}@example.com")
    r = await client.post(
        "/api/dictionary/external/custom",
        json=_custom_body(name="x" * 41),
        headers={"X-CSRF-Token": csrf},
    )
    assert r.status_code == 422


async def test_limit_reached_returns_409(client: AsyncClient) -> None:
    csrf = await register_and_onboard(client, f"ext-limit-{uuid.uuid4().hex}@example.com")
    for i in range(30):
        await _create(client, csrf, name=f"d{i}")
    r = await client.post(
        "/api/dictionary/external/custom", json=_custom_body(), headers={"X-CSRF-Token": csrf}
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "limit_reached"


async def test_mutations_require_csrf(client: AsyncClient) -> None:
    await register_and_onboard(client, f"ext-csrf-{uuid.uuid4().hex}@example.com")
    r = await client.post("/api/dictionary/external/custom", json=_custom_body())
    assert r.status_code == 403


async def test_custom_dictionary_isolated_between_users() -> None:
    marker = uuid.uuid4().hex
    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as owner:
        owner_csrf = await register_and_onboard(owner, f"ext-a-{marker}@example.com")
        custom = await _create(owner, owner_csrf)
        url = f"/api/dictionary/external/custom/{custom['custom_id']}"
        async with AsyncClient(transport=transport, base_url="http://test") as other:
            other_csrf = await register_and_onboard(other, f"ext-b-{marker}@example.com")
            headers = {"X-CSRF-Token": other_csrf}
            listed = (await other.get("/api/dictionary/external", params=PAIR)).json()
            assert custom["ref"] not in [d["ref"] for d in listed["visible"] + listed["available"]]
            assert (await other.patch(url, json=_custom_body(), headers=headers)).status_code == 404
            assert (await other.delete(url, headers=headers)).status_code == 404
        # Still intact for the owner.
        listed = (await owner.get("/api/dictionary/external", params=PAIR)).json()
        assert custom["ref"] in [d["ref"] for d in listed["visible"]]


async def test_lookup_no_longer_returns_external_links(client: AsyncClient) -> None:
    await register_and_onboard(client, f"ext-lookup-{uuid.uuid4().hex}@example.com")
    r = await client.get(
        "/api/dictionary/lookup", params={"lang": "pt", "target": "ru", "text": "casa"}
    )
    assert r.status_code == 200, r.text
    assert "external_links" not in r.json()
