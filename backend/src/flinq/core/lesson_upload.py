"""Bound lesson multipart uploads before the parser allocates temporary files."""

from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_LESSON_FILE_BYTES = 5 * 1024 * 1024
# Allow bounded space for multipart boundaries, headers, title and language.
_MAX_REQUEST_BYTES = MAX_LESSON_FILE_BYTES + 64 * 1024


class LessonUploadMiddleware:
    """Runs after session/CSRF middleware, before FastAPI's multipart parser.

    Buffer at most one small lesson upload, then replay it to the normal parser.
    Counting streamed bytes also covers absent or dishonest Content-Length.
    Other routes retain their existing streaming behavior.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or scope["path"].rstrip("/") != "/api/lessons/import-file"
        ):
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        if getattr(request.state, "user_id", None) is None:
            await JSONResponse({"detail": "Unauthorized"}, status_code=401)(scope, receive, send)
            return
        too_large = JSONResponse({"detail": "lesson file too large"}, status_code=413)
        length = request.headers.get("content-length")
        if length and length.isdecimal() and int(length) > _MAX_REQUEST_BYTES:
            await too_large(scope, receive, send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > _MAX_REQUEST_BYTES:
                await too_large(scope, receive, send)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        delivered = False

        async def replay() -> Message:
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)
