"""Health check endpoint.

Liveness stays independent of dependencies; readiness checks the release schema,
PostgreSQL and Redis without disclosing configuration or exception details.
"""

from __future__ import annotations

import asyncio
from functools import lru_cache
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text

from glosano import __version__
from glosano.core.db import get_engine
from glosano.core.redis import get_redis_client

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    version: str


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__)


@lru_cache(maxsize=1)
def expected_heads() -> frozenset[str]:
    """Read the migrations shipped alongside this release, never a DB value."""
    migrations = Path(__file__).resolve().parents[3] / "migrations"
    return frozenset(ScriptDirectory(str(migrations)).get_heads())


@router.get("/health/ready", include_in_schema=False)
async def ready() -> JSONResponse:
    try:
        async with asyncio.timeout(5):
            async with get_engine().connect() as connection:
                await connection.execute(text("SELECT 1"))
                heads = await connection.run_sync(
                    lambda conn: frozenset(MigrationContext.configure(conn).get_current_heads())
                )
            if heads != expected_heads():
                return JSONResponse({"status": "not_ready"}, status_code=503)
            # Redis ships incomplete annotations for its asynchronous commands.
            if not await get_redis_client().execute_command("PING"):  # pyright: ignore[reportUnknownMemberType]
                return JSONResponse({"status": "not_ready"}, status_code=503)
    except Exception:
        return JSONResponse({"status": "not_ready"}, status_code=503)
    return JSONResponse({"status": "ready"})
