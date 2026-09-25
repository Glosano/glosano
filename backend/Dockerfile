# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for Glosano backend.
# Stages:
#   - builder       : installs Python deps via uv into a cached virtualenv
#   - frontend-build: builds frontend static assets via pnpm
#   - dev           : dev image with source mounted, uv-managed env
#   - runtime       : slim production image with deps + frontend assets

# ──────────────────────────────────────────────────────────
ARG PYTHON_VERSION=3.13
ARG NODE_VERSION=22

# ──────────────────────────────────────────────────────────
# 1. Python dependency builder
# ──────────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION}-slim-bookworm AS builder

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app/backend

# Install dependencies only (leverage Docker layer caching).
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Copy source and install project
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY backend/alembic.ini ./
COPY backend/README.md ./
COPY LICENSE /app/LICENSE
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# ──────────────────────────────────────────────────────────
# 2. Frontend build
# ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS frontend-build

WORKDIR /app/frontend

RUN corepack enable

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm build

# ──────────────────────────────────────────────────────────
# 3. Dev image (source is mounted at runtime, deps cached)
# ──────────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION}-slim-bookworm AS dev

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /app/LICENSE /app/LICENSE

WORKDIR /app/backend

EXPOSE 8000

# Source is mounted via docker-compose.dev.yml
CMD ["uv", "run", "uvicorn", "glosano.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ──────────────────────────────────────────────────────────
# 4. Runtime (production)
# ──────────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime

# The venv from the builder is complete and frozen: never let uv re-sync it
# at runtime (a bare `uv run` would pull the dev group over the network).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_NO_SYNC=1 \
    UV_FROZEN=1 \
    PATH="/opt/venv/bin:$PATH" \
    GLOSANO_STATIC_DIR=/app/frontend/dist

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash glosano \
    && mkdir -p /var/lib/glosano \
    && chown -R glosano:glosano /var/lib/glosano

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY --from=builder --chown=glosano:glosano /opt/venv /opt/venv
COPY --from=builder --chown=glosano:glosano /app/backend /app/backend
COPY --from=builder --chown=glosano:glosano /app/LICENSE /app/LICENSE
COPY --from=frontend-build --chown=glosano:glosano /app/frontend/dist /app/frontend/dist

USER glosano
WORKDIR /app/backend

EXPOSE 8000

CMD ["glosano", "serve", "--host", "0.0.0.0", "--port", "8000"]
