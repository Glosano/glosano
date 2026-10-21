from types import TracebackType
from typing import Self

class PostgresContainer:
    def __init__(
        self,
        image: str = ...,
        port: int = ...,
        username: str | None = ...,
        password: str | None = ...,
        dbname: str | None = ...,
        driver: str | None = ...,
    ) -> None: ...
    def __enter__(self) -> Self: ...
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None: ...
    def get_container_host_ip(self) -> str: ...
    def get_exposed_port(self, port: int) -> int: ...
    def get_connection_url(self, host: str | None = ..., driver: str | None = ...) -> str: ...
