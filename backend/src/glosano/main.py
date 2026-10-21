"""FastAPI application factory.

Used by both uvicorn (`glosano.main:app`) and the `glosano serve` CLI entry point.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from loguru import logger
from starlette.middleware.trustedhost import TrustedHostMiddleware

from glosano import __version__
from glosano.api.admin import router as admin_router
from glosano.api.ai import router as ai_router
from glosano.api.auth import router as auth_router
from glosano.api.chats import router as chats_router
from glosano.api.dictionary import router as dictionary_router
from glosano.api.health import router as health_router
from glosano.api.lessons import router as lessons_router
from glosano.api.me import router as me_router
from glosano.api.reader import router as reader_router
from glosano.api.review import router as review_router
from glosano.api.stats import router as stats_router
from glosano.api.vocabulary import router as vocabulary_router
from glosano.api.vocabulary_import import router as vocabulary_import_router
from glosano.core.config import get_settings
from glosano.core.db import dispose_engine, init_engine
from glosano.core.lesson_upload import LessonUploadMiddleware
from glosano.core.logging import configure_logging
from glosano.core.spa import SpaStaticFiles
from glosano.modules.identity.middleware import CSRFMiddleware, SessionMiddleware
from glosano.modules.lingq_import import jobs as import_jobs


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    """Application lifespan: initialise engine, yield, then dispose on shutdown."""
    settings = get_settings()
    configure_logging(settings)
    init_engine(settings)
    try:
        await import_jobs.mark_interrupted_jobs()
    except Exception as exc:
        # Do not keep the API down over this cleanup (e.g. migration not applied yet).
        logger.warning("Could not mark interrupted vocabulary imports ({})", type(exc).__name__)
    logger.info("Glosano API starting (version={}, env={})", __version__, settings.env)
    try:
        yield
    finally:
        await import_jobs.shutdown()
        await dispose_engine()
        logger.info("Glosano API stopped")


def create_app() -> FastAPI:
    """Build and return the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title="Glosano API",
        version=__version__,
        lifespan=lifespan,
    )

    # Starlette stacks middleware in reverse add order: last added = outermost (runs first).
    # Execution order wanted: Session (sets state) → CSRF → upload limit → GZip → handler.
    # GZip must be innermost (closest to the handler) so it compresses responses
    # before they pass back up through CSRF/Session — it is added FIRST.
    # Session must be outermost, so it is added LAST.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(LessonUploadMiddleware)
    app.add_middleware(CSRFMiddleware)
    app.add_middleware(SessionMiddleware)  # outer — runs first per request

    if settings.local_http:
        # Reject non-local Host headers before sessions or other application work.
        app.add_middleware(
            TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"], www_redirect=False
        )

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(me_router)
    app.include_router(lessons_router)
    app.include_router(reader_router)
    app.include_router(review_router)
    app.include_router(stats_router)
    app.include_router(dictionary_router)
    app.include_router(vocabulary_router)
    app.include_router(vocabulary_import_router)
    app.include_router(ai_router)
    app.include_router(admin_router)
    app.include_router(chats_router)

    # Serve frontend static assets in production (see architecture §5.3).
    if settings.static_dir is not None and settings.static_dir.exists():
        app.mount(
            "/",
            SpaStaticFiles(directory=str(settings.static_dir), html=True),
            name="frontend",
        )

    return app


app = create_app()
