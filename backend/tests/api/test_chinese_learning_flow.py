"""Chinese upload, reader, personal vocabulary and SRS without an AI provider."""

import uuid

import pytest
from httpx import AsyncClient

from flinq.core.config import get_settings
from flinq.worker.tasks import run_lesson_import
from tests.api.test_me_settings import register


async def test_chinese_learning_flow(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("FLINQ_LLM_ENABLED", "false")
    get_settings.cache_clear()
    jobs: list[tuple[uuid.UUID, uuid.UUID]] = []

    async def enqueue(lesson_id: uuid.UUID, job_id: uuid.UUID) -> None:
        jobs.append((lesson_id, job_id))

    monkeypatch.setattr("flinq.api.lessons.enqueue_lesson_import", enqueue)
    await register(client)
    response = await client.post(
        "/me/onboarding",
        json={
            "ui_language": "ru",
            "learning_languages": ["zh-Hans"],
        },
    )
    assert response.status_code == 200
    response = await client.post(
        "/api/lessons/import-file",
        data={"language_code": "zh-Hans"},
        files={"file": ("中文.txt", "我喜欢学习中文。".encode(), "text/plain")},
    )
    assert response.status_code == 202, response.text
    lesson_id = response.json()["id"]
    await run_lesson_import(*jobs[0])
    response = await client.get(f"/api/lessons/{lesson_id}/content")
    assert response.status_code == 200
    content = response.json()
    assert content["word_count"] == 4
    sentence = content["paragraphs"][0]["sentences"][0]
    assert [t["t"] for t in sentence["tokens"] if "t" in t] == ["我", "喜欢", "学习", "中文"]
    assert (
        "".join(t.get("t", t.get("p", t.get("ws", ""))) for t in sentence["tokens"])
        == sentence["text"]
    )
    response = await client.get(
        "/api/dictionary/lookup", params={"lang": "zh-Hans", "target": "ru", "text": "学习"}
    )
    assert response.status_code == 200
    assert response.json()["availability"] == "not_installed"
    assert response.json()["entries"] == []
    assert response.json()["attribution"]["license"] == "CC-BY-SA 4.0"
    for kind, text, translation in [
        ("token", "学习", "учиться"),
        ("phrase", "学习中文", "учить китайский"),
    ]:
        response = await client.post(
            "/api/vocabulary/items",
            json={
                "kind": kind,
                "language_code": "zh-Hans",
                "text": text,
                "status": "tracked",
                "confidence": 1,
                "lesson_id": lesson_id,
                "segment_id": sentence["seg_id"],
            },
        )
        assert response.status_code == 201, response.text
        item_id = response.json()["item_id"]
        response = await client.post(
            f"/api/vocabulary/items/{kind}/{item_id}/translations",
            json={
                "target_language_code": "ru",
                "translation_text": translation,
                "source_type": "user",
            },
        )
        assert response.status_code == 201
        response = await client.get(
            "/api/vocabulary/lookup",
            params={
                "lang": "zh-Hans",
                "target": "ru",
                "kind": kind,
                "text": text,
            },
        )
        assert response.json()["status"] == "tracked"
        assert response.json()["translations"]["primary"]["text"] == translation
    queue = await client.get("/api/review/queue", params={"lang": "zh-Hans"})
    assert queue.status_code == 200
    assert {item["item_kind"] for item in queue.json()["items"]} == {"token", "phrase"}
    counts = await client.get("/api/review/counts", params={"lang": "zh-Hans"})
    assert counts.json()["ai_enabled"] is False
    overview = await client.get("/api/stats/overview", params={"lang": "zh-Hans"})
    assert overview.status_code == 200
    assert overview.json()["tracked_items_count"] == 2
    assert overview.json()["known_items_count"] == 0
    get_settings.cache_clear()
