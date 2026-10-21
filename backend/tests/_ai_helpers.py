"""Typed provider factory for deterministic AI endpoint tests."""

from collections.abc import Callable

from glosano.core.config import Settings


def provider_factory[T](provider: T) -> Callable[[Settings], T]:
    def factory(_settings: Settings) -> T:
        return provider

    return factory
