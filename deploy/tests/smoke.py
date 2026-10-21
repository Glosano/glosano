"""Exercise a disposable production stack, including the real Redis worker."""
import time
import uuid

import httpx

with httpx.Client(base_url="http://app-api:8000", timeout=10) as client:
    for attempt in range(60):
        try:
            if client.get("/health").status_code == 200:
                break
        except httpx.HTTPError:
            pass
        time.sleep(1)
    else:
        raise AssertionError("API did not start")
    page = client.get("/")
    assert page.status_code == 200 and '<div id="root">' in page.text, page.text[:200]
    response = client.post("/auth/register", json={
        "display_name": "Container smoke", "email": f"smoke-{uuid.uuid4().hex}@example.com",
        "password": uuid.uuid4().hex,
    })
    assert response.status_code == 201, response.text
    # This internal HTTP test explicitly forwards Secure cookies. Browser/TLS
    # acceptance is a separate test; do not weaken production cookie settings.
    client.headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in response.cookies.items())
    client.headers["X-CSRF-Token"] = response.cookies["glosano_csrf"]
    response = client.post("/me/onboarding", json={
        "ui_language": "en", "native_language": "en", "learning_languages": ["pt"],
    })
    assert response.is_success, response.text
    response = client.post("/api/lessons", json={
        "title": "Container smoke", "language_code": "pt",
        "raw_text": "Olá mundo. Uma pequena história para aprender.", "visibility": "private",
    })
    assert response.status_code == 202, response.text
    lesson_id = response.json()["id"]
    for attempt in range(90):
        response = client.get(f"/api/lessons/{lesson_id}")
        assert response.status_code == 200, response.text
        if response.json()["status"] == "ready":
            break
        assert response.json()["status"] != "failed", response.text
        time.sleep(1)
    else:
        raise AssertionError("Worker did not finish the import")
    assert response.json()["word_count"] > 0, response.text
    assert client.get("/me").json()["ai_enabled"] is False
    response = client.post("/api/vocabulary/items", json={
        "kind": "token", "language_code": "pt", "text": "mundo",
        "status": "tracked", "confidence": 1, "lesson_id": lesson_id,
    })
    assert response.status_code == 201, response.text
    item_id = response.json()["item_id"]
    response = client.get(f"/api/lessons/{lesson_id}/vocabulary?target=en")
    assert response.status_code == 200, response.text
    item = next(row for row in response.json()["items"] if row["text"] == "mundo")
    assert item["item_id"] == item_id and item["status"] == "tracked", item
print("PASS: production UI, authentication, onboarding, worker import and vocabulary save (AI disabled)")
