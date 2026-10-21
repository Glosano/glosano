<p align="center">
  <img src="docs/assets/glosano-logo.png" alt="Glosano" width="220">
</p>

<p align="center">
  <b>Learn languages from texts and videos you actually want to read — on your own server.</b>
</p>

<p align="center">
  <a href="docs/self-hosting.md">Self-hosting guide</a> ·
  <a href="#development">Development</a> ·
  <a href="docs/adr/">Decisions</a> ·
  <a href="LICENSE">MIT license</a>
</p>

---

Glosano is a self-hosted, LingQ-style platform for content-driven language learning. Import an article, a book chapter or a YouTube video, read it in an interactive reader, save the words and phrases you don't know, and review them with spaced repetition. Everything — your library, vocabulary and progress — stays on a server you own.

<p align="center">
  <img src="docs/assets/glosano-demo-compact.gif" alt="Glosano demo: importing a Spanish text and a YouTube video, translating words in context, saving them for review" width="800">
</p>

## Features

- **Import anything readable.** `.txt` and `.md` files, YouTube videos with captions in the language you learn, and whole web pages through the Chrome/Firefox importer extension. Keep lessons private or share them with everyone on your instance.
- **Interactive reader.** Page and sentence modes; every word is coloured by how well you know it. Turning the page marks the remaining new words as known, with undo.
- **Word and phrase cards.** Wiktionary definitions, links to external dictionaries, grammar tags, and an optional in-context AI translation, clearly marked as AI-generated.
- **Personal vocabulary and SRS.** Each word form is learned on its own; phrases are first-class. One review queue for both.
- **Statistics that mean something.** Words read, words in study, words known — ignored proper nouns and junk tokens never inflate the count.
- **AI is optional.** Plug in any OpenAI-compatible provider (OpenAI, OpenRouter, Ollama, LM Studio, vLLM) or none at all — the reader, dictionary, vocabulary and review work without it.
- **Ten learning languages, nine interface languages.** Learn English, Russian, Portuguese, Spanish, French, German, Simplified Chinese, Japanese, Arabic or Hindi; translations go to your native language.
- **Your data is yours.** JSON export and account deletion for every learner; a single switch cuts off all AI calls.

**Status:** MVP in active development. Still ahead: the admin panel and full touch support on phones and tablets.

## Self-hosting

Glosano ships as a Docker Compose stack with prebuilt **amd64 / arm64** images.
On a Linux machine with Docker Engine and Compose v2.20+ already installed:

```bash
curl -fsSL https://github.com/Glosano/glosano/releases/latest/download/install.sh | bash
```

The installer asks for a directory, admin email and URL, generates the configuration,
prepares the database and starts Glosano. Use `http://localhost:8000` for a local
browser trial. Access from other devices needs an **existing HTTPS reverse proxy**.
AI and dictionaries are optional. Re-running the installer preserves your data
and credentials; updates are a separate, deliberate action.

Prefer to inspect the script first? Download `install.sh` from the selected
[release](https://github.com/Glosano/glosano/releases), read it, then run `bash install.sh`.

See the **[self-hosting guide](docs/self-hosting.md)** for the installer, manual
[Docker Compose deployment](docs/docker-compose-install.md), HTTPS, backups,
updates, dictionaries and AI providers.

## Development

Requirements: Docker, [`uv`](https://docs.astral.sh/uv/) for the backend, Node.js with `corepack` enabled for `pnpm`.

```bash
cp .env.example .env
cd backend && uv sync && cd ..
cd frontend && corepack pnpm install && cd ..
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

| | |
|---|---|
| Frontend (Vite) | <http://localhost:5173> |
| Backend API | <http://localhost:8000> |
| Health check | <http://localhost:8000/health> |

### Backend

```bash
cd backend
uv sync                          # install deps
uv run glosano serve             # run API locally (http://localhost:8000)
uv run glosano worker            # run Taskiq worker
uv run pytest                    # run tests
uv run ruff check .              # lint
uv run ruff format .             # format
uv run pyright                   # type check
uv run alembic upgrade head      # apply migrations
uv run alembic revision --autogenerate -m "message"  # create a migration
```

### Frontend

```bash
cd frontend
corepack pnpm install            # install deps
corepack pnpm dev                # start Vite dev server
corepack pnpm build              # production build
corepack pnpm test               # run Vitest
corepack pnpm lint               # ESLint
corepack pnpm format             # Prettier
```

### Browser extension

See [`extension/README.md`](extension/README.md).

### Repository layout

```
glosano/
├── backend/          # Python 3.13 + FastAPI + SQLAlchemy + Taskiq
├── frontend/         # React 19 + TypeScript + Vite + Tailwind v4
├── extension/        # Browser importer (WXT, Chrome + Firefox MV3)
├── docs/             # Self-hosting guide, product and architecture docs
├── docker-compose.yml
└── docker-compose.dev.yml
```

See [ADR-0006](docs/adr/ADR-0006-tech-stack.md) for the full tech stack.

## Documentation

- [`docs/self-hosting.md`](docs/self-hosting.md) — running your own instance.
- [`docs/lingq-like-self-hosted-spec-2026.md`](docs/lingq-like-self-hosted-spec-2026.md) — source product specification.
- [`docs/specs/2026-04-11-mvp-product-alignment-design.md`](docs/specs/2026-04-11-mvp-product-alignment-design.md) — MVP decision log.
- [`docs/architecture/2026-04-11-mvp-architecture-overview.md`](docs/architecture/2026-04-11-mvp-architecture-overview.md) — high-level architecture.
- [`docs/adr/`](docs/adr/) — architecture decision records.

Agent guidance: [`AGENTS.md`](AGENTS.md) (English) / [`AGENTS_RU.md`](AGENTS_RU.md) (Russian).

## License

MIT — see [LICENSE](LICENSE).

Glosano uses Wiktionary-derived dictionary data from [Kaikki.org](https://kaikki.org/) under CC-BY-SA 4.0. Attribution is shown in the UI wherever dictionary data is displayed — see [ADR-0004](docs/adr/ADR-0004-dictionary-wiktionary-provider.md).
