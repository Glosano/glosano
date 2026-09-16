"""Taskiq broker setup.

Production uses a Redis broker. Tests swap in `InMemoryBroker` via environment.
"""

from __future__ import annotations

import asyncio

from loguru import logger
from taskiq import InMemoryBroker, TaskiqEvents, TaskiqState
from taskiq.abc.broker import AsyncBroker
from taskiq_redis import ListQueueBroker, RedisAsyncResultBackend

from glosano.core.config import get_settings
from glosano.core.db import dispose_engine, init_engine, session_scope
from glosano.core.logging import configure_logging

_settings = get_settings()


def _build_broker() -> AsyncBroker:
    if _settings.env == "test":
        return InMemoryBroker()
    return ListQueueBroker(url=_settings.redis_url).with_result_backend(
        RedisAsyncResultBackend(redis_url=_settings.redis_url)
    )


broker: AsyncBroker = _build_broker()


async def run_import_maintenance() -> None:
    """Recover abandoned imports even when no separate Taskiq scheduler runs."""
    from glosano.modules.lesson_library.video_import import expire_imports

    while True:
        try:
            async with session_scope() as session:
                await expire_imports(session)
        except Exception:
            logger.warning("Video import maintenance failed; retrying in 60 seconds")
        await asyncio.sleep(60)


# The worker process does not run the FastAPI lifespan, so it must initialise the
# database engine itself. Without this, any task using session_scope() fails with
# "Database engine not initialized". Mirrors glosano.main.lifespan. Tests use the
# InMemoryBroker and manage the engine via fixtures, so skip registration there.
if _settings.env != "test":

    @broker.on_event(TaskiqEvents.WORKER_STARTUP)
    async def _init_worker_engine(_state: TaskiqState) -> None:  # pyright: ignore[reportUnusedFunction]
        settings = get_settings()
        configure_logging(settings)
        init_engine(settings)
        _state.import_maintenance = asyncio.create_task(run_import_maintenance())

    @broker.on_event(TaskiqEvents.WORKER_SHUTDOWN)
    async def _dispose_worker_engine(_state: TaskiqState) -> None:  # pyright: ignore[reportUnusedFunction]
        task = _state.import_maintenance
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await dispose_engine()
