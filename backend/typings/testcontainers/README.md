# Testcontainers type surface

These local stubs describe the Postgres/Redis APIs used by our integration tests.
Signatures were checked against testcontainers 4.14.2 (the version in uv.lock).
The dependency does not ship a py.typed marker. Pyright finds this directory
through its default `typings` stub path; strict diagnostics remain enabled.

This is intentionally a small API surface, without a catch-all for attributes
or keyword arguments. Extend it from the installed implementation when tests
need another method. Real Docker integration and migration tests exercise the
constructors, context managers, connection URL, host and port methods.
