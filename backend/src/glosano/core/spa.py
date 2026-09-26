"""Static serving of the built SPA with a client-side routing fallback (ADR-0006)."""

from __future__ import annotations

from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.types import Scope

# First path segments owned by the backend: an unknown path under them is a real
# 404, never a page of the SPA.
BACKEND_PREFIXES = frozenset({"api", "auth", "me", "health"})


class SpaStaticFiles(StaticFiles):
    """Serve files from the build; answer unknown client routes with index.html.

    Without the fallback a reload or deep link such as /learn/pt/library hits
    StaticFiles and gets a 404, because only the browser router knows the route.
    Paths whose last segment has an extension are asset requests and keep their 404.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or not is_client_route(path):
                raise
            return await super().get_response("index.html", scope)


def is_client_route(path: str) -> bool:
    segments = [segment for segment in path.split("/") if segment and segment != "."]
    if not segments:
        return True
    return segments[0] not in BACKEND_PREFIXES and "." not in segments[-1]
