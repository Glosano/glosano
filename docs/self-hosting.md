<p align="center">
  <img src="assets/glosano-logo.png" alt="Glosano" width="200">
</p>

<h1 align="center">Self-hosting Glosano</h1>

<p align="center">
  Run your own Glosano instance — for yourself, your family or a small team — with Docker Compose.
</p>

---

This guide takes you from an empty Linux server to a working instance at `https://glosano.example.com`: HTTPS, an admin account, a built-in dictionary and, optionally, AI translation. Prebuilt releases avoid a local build. AI and dictionary downloads are optional.

**Contents**

1. [What you need](#1-what-you-need)
2. [What runs where](#2-what-runs-where)
3. [Install](#3-install)
4. [Put it behind HTTPS](#4-put-it-behind-https)
5. [Accounts and the first admin](#5-accounts-and-the-first-admin)
6. [Load a dictionary](#6-load-a-dictionary)
7. [Turn on AI translation (optional)](#7-turn-on-ai-translation-optional)
8. [Browser importer (optional)](#8-browser-importer-optional)
9. [Update to a new version](#9-update-to-a-new-version)
10. [Back up and restore](#10-back-up-and-restore)
11. [Configuration reference](#11-configuration-reference)
12. [Troubleshooting](#12-troubleshooting)

## 1. What you need

| | Minimum | Comfortable |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 2 GB | 4 GB |
| Disk | 5 GB | 10 GB + ~1 GB per dictionary |
| OS | Any Linux that runs Docker | Ubuntu 24.04 / Debian 12 |

- **Docker Engine with Compose v2.20+** (`docker compose version` must work). Releases use prebuilt public GHCR images for amd64 and arm64.
- The one-command installer supports **Linux** and requires Bash, curl, OpenSSL and sha256sum. It does not install Docker. Git is needed only for the source-build alternative.
- **A domain name and HTTPS.** In production Glosano marks its session cookie `Secure`, so browsers only keep it over HTTPS. Plain `http://localhost` is the one exception browsers make — fine for a trial on your own machine, not for anyone else on the network.
- **Outbound internet** from the server for dictionary downloads, YouTube captions and an AI provider, if you use one.

## 2. What runs where

`docker compose up` starts four containers:

| Service | Role | Data |
|---|---|---|
| `app-api` | FastAPI backend; also serves the web app | — |
| `app-worker` | Background jobs: lesson processing, YouTube imports | — |
| `postgres` | All user data, lessons, vocabulary, dictionary | volume `postgres_data` |
| `redis` | Job queue, rate limits, short-lived caches | volume `redis_data` |

`app-api` and `app-worker` run from the same image and share the `app_data` volume, which holds the downloaded dictionary dumps. Everything worth backing up lives in Postgres.

## 3. Install

### One-command installation (Linux)

```bash
curl -fsSL https://github.com/Glosano/glosano/releases/latest/download/install.sh | bash
```

The installer asks for an empty directory, the administrator's email and the
application URL. Keep the default localhost URL for a browser on the same machine.
For a server, configure the HTTPS proxy first (section 4), then enter its HTTPS
origin. The installer checks both local container health and that URL. If the
proxy is not ready, it reports the incomplete setup rather than claiming success.

It generates secrets, downloads the matching release Compose with SHA256
verification, applies migrations and creates the first admin. The temporary
password is printed in the invoking terminal, not container logs. Change it in
Settings. Public registration is closed; AI is disabled and dictionaries are not
downloaded automatically.

To avoid interactive questions, download and inspect `install.sh` from a release,
then run it with these inputs:

```bash
GLOSANO_INSTALL_DIR="$HOME/glosano" \
GLOSANO_ADMIN_EMAIL=you@example.com \
GLOSANO_URL=https://glosano.example.com \
bash install.sh
```

`GLOSANO_BIND` can select another IPv4 address and port (default
`127.0.0.1:8000`). Match the URL/proxy to that binding. Never use plain HTTP on a
LAN address as a workaround for production cookies. For a container-based proxy,
see [networking in the Compose guide](docker-compose-install.md).

The selected directory contains `compose.yaml`, `.env` (mode 600) and an installer
version marker. Keep these files. Run the **same release's** installer to resume
a download/startup failure. It preserves secrets and existing admin passwords and
refuses to overwrite a customized Compose file or upgrade to a different release.
A hard-killed installer may leave `.install.lock`; remove that empty directory
only after confirming no installer is still running. Invalid admin email saved
by a failed attempt can be corrected in `GLOSANO_INSTALL_ADMIN_EMAIL` in `.env`.

A particular version can be installed by downloading its own `install.sh` from
[GitHub Releases](https://github.com/Glosano/glosano/releases). Checksums verify
asset consistency; they are not an independent signature of GitHub downloads.

For manual setup use the [release Compose guide](docker-compose-install.md).
The remaining commands in sections 3.1–3.4 describe the **source-build alternative**.
Release installations use database/user `glosano`; the source-build example below
uses `flinq`. Follow the matching guide for updates and backups.

### 3.1 Get the code

```bash
git clone https://github.com/Glosano/glosano.git /opt/glosano
cd /opt/glosano
```

### 3.2 Write `.env`

Compose reads `.env` next to `docker-compose.yml`. Start from the template and change the values below — the rest can stay as they are:

```bash
cp .env.example .env
chmod 600 .env
```

```dotenv
GLOSANO_ENV=prod
GLOSANO_SECRET_KEY=<output of: openssl rand -hex 32>

# Change the database password. Both lines must agree. Letters and digits only:
# the password also goes into a URL, where characters like @ : / break it.
POSTGRES_PASSWORD=<output of: openssl rand -hex 24>
GLOSANO_DATABASE_URL=postgresql+asyncpg://flinq:<the same password>@postgres:5432/flinq

# app-api listens only on the server itself; the reverse proxy (step 4) faces the internet.
GLOSANO_BIND=127.0.0.1:8000
FORWARDED_ALLOW_IPS=*
```

> [!IMPORTANT]
> `POSTGRES_*` are applied only when the database volume is created. To change the password later, change it inside Postgres (`ALTER USER flinq PASSWORD '…'`) and then update `.env`.

### 3.3 Build, migrate, start

```bash
docker compose build
docker compose run --rm app-api alembic upgrade head
docker compose up -d
```

The first build takes a few minutes: it installs the Python dependencies and builds the web app. Migrations never run on startup — `alembic upgrade head` is a deliberate step here and on every update.

### 3.4 Check it

```bash
docker compose ps
curl http://127.0.0.1:8000/health
```

All four services should be `Up` (`postgres` and `redis` also `(healthy)`), and `/health` should answer `{"status":"ok","version":"…"}`.

## 4. Put it behind HTTPS

Point your domain's DNS at the server, then put a reverse proxy in front of `127.0.0.1:8000`. Any proxy works as long as it passes `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`, and allows request bodies of at least 5 MB — the limit for an imported text file.

### Option A: Caddy (gets certificates by itself)

`/etc/caddy/Caddyfile`:

```caddyfile
glosano.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

```bash
sudo systemctl reload caddy
```

### Option B: nginx + Let's Encrypt

`/etc/nginx/sites-available/glosano`:

```nginx
server {
    listen 80;
    server_name glosano.example.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/glosano /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d glosano.example.com
```

`certbot` adds the `listen 443 ssl` block and the redirect from HTTP, and renews the certificate on its own.

Open `https://glosano.example.com` — you should see the sign-in screen with the Glosano logo.

## 5. Accounts and the first admin

Glosano uses email and password; there is no SSO and no email delivery.

**First admin.** Create it from the command line; the generated password is printed once — sign in and change it in **Settings → Profile**:

```bash
docker compose run --rm app-api glosano identity create-admin you@example.com --name "Your Name"
```

Use an address with a real-looking domain. `create-admin` accepts any address, but sign-in and sign-up reject reserved domains such as `.local`, `.test` or `.localhost`, so an admin created with one can never sign in.

> [!WARNING]
> `GLOSANO_INITIAL_ADMIN_EMAIL` is another way: whoever signs up with that address becomes admin. Glosano does not verify email addresses, so on a site that is already reachable from the internet a stranger who guesses the address can sign up first. Use it only before the site is public, or not at all.

**Inviting people.** While `GLOSANO_ALLOW_PUBLIC_REGISTRATION=true`, anyone who can reach the site can sign up. Once your family or team has registered, close it:

```dotenv
GLOSANO_ALLOW_PUBLIC_REGISTRATION=false
```

```bash
docker compose up -d
```

**Forgotten passwords** are reset by the server owner — there is no "forgot password" email:

```bash
docker compose run --rm app-api glosano identity reset-password someone@example.com
docker compose run --rm app-api glosano identity promote someone@example.com   # make admin
```

## 6. Load a dictionary

Word cards show entries from Wiktionary, taken from [Kaikki.org](https://kaikki.org/) dumps. Nothing is downloaded automatically: load the pairs your learners need. `--lang` is the language being learned, `--target` the language of the definitions.

```bash
docker compose run --rm app-api glosano dictionary refresh --lang en --target ru
```

| `--lang` | `--target` | Source | Download |
|---|---|---|---|
| `en` | `ru` | English Wiktionary | ~520 MB |
| `en` | `pt` | English Wiktionary | ~520 MB (same file as `en`→`ru`) |
| `ru` | `en` | English Wiktionary | ~90 MB |
| `pt` | `en` | English Wiktionary | ~580 MB |
| `pt` | `ru` | Russian Wiktionary | ~15 MB |

A large dump takes 10–20 minutes to import, and kaikki.org is sometimes slow to serve it. Run long imports detached and follow their progress (logged every 50 MB downloaded):

```bash
docker compose run -d --name glosano-dict-en-ru app-api glosano dictionary refresh --lang en --target ru
docker logs -f glosano-dict-en-ru
docker rm glosano-dict-en-ru   # once it has finished
```

Each download is saved in the `app_data` volume under `/var/lib/glosano/dictionary-dumps/`. `refresh` downloads the dump again every time; to re-import the saved copy instead, pass it with `--file`:

```bash
docker compose run --rm app-api glosano dictionary refresh --lang en --target ru \
  --file /var/lib/glosano/dictionary-dumps/kaikki.org-dictionary-English.jsonl.gz
```

To load a dump you downloaded yourself, mount it into the container:

```bash
docker compose run --rm -v "$PWD/dump.jsonl:/tmp/dump.jsonl:ro" app-api \
  glosano dictionary refresh --lang pt --target en --file /tmp/dump.jsonl
```

Dictionary data is licensed CC-BY-SA 4.0; Glosano shows the attribution on every card that uses it. The reader, vocabulary and review work without any dictionary — cards just have no dictionary section.

## 7. Turn on AI translation (optional)

Glosano works without AI. With a provider configured, word cards gain a contextual translation (marked as AI-generated) and the reader gains an AI chat. Any service that speaks the OpenAI Chat Completions API works:

```dotenv
GLOSANO_LLM_ENABLED=true

# OpenAI
GLOSANO_LLM_BASE_URL=https://api.openai.com/v1
GLOSANO_LLM_API_KEY=sk-...
GLOSANO_LLM_MODEL=gpt-4o-mini

# …or OpenRouter (also the way to reach Anthropic, Google and others)
# GLOSANO_LLM_BASE_URL=https://openrouter.ai/api/v1
# GLOSANO_LLM_MODEL=openai/gpt-4o-mini

# …or a local Ollama / LM Studio / vLLM on the same host
# GLOSANO_LLM_BASE_URL=http://host.docker.internal:11434/v1
# GLOSANO_LLM_API_KEY=ollama
# GLOSANO_LLM_MODEL=llama3.1
```

Apply with `docker compose up -d`. On Linux, `host.docker.internal` needs `extra_hosts: ["host.docker.internal:host-gateway"]` on `app-api` and `app-worker` in a `docker-compose.override.yml`.

`GLOSANO_LLM_ENABLED=false` is the kill switch: AI sections disappear and nothing is sent to the provider. AI answers are cached per user and never shared between accounts.

## 8. Browser importer (optional)

The Glosano Importer extension for Chrome and Firefox sends articles, selected text and YouTube videos from any page to your instance, using the session of whoever is signed in. Build and install it as described in [`extension/README.md`](../extension/README.md), then enter your instance address in its settings.

## 9. Update to a new version

**Release installations:** follow [the release update and restore procedure](docker-compose-install.md#update-deliberately). Do not re-run a newer installer as an updater.

**Source-build installations:**

```bash
cd /opt/glosano
git pull
docker compose build
docker compose exec -T postgres pg_dump -U flinq -Fc flinq > ~/glosano-$(date +%F).dump
docker compose run --rm app-api alembic upgrade head
docker compose up -d
curl http://127.0.0.1:8000/health
```

Take the backup before migrating: some migrations cannot be rolled back.

## 10. Back up and restore

**Release installations:** use [the release backup and restore commands](docker-compose-install.md#update-deliberately), which use database/user `glosano`. Commands below are for the source-build `flinq` database.

Back up Postgres; it holds everything. Redis keeps only queues and caches, and the `app_data` volume only re-downloadable dictionary dumps.

```bash
# Back up (run from cron, e.g. nightly; keep copies off the server)
docker compose exec -T postgres pg_dump -U flinq -Fc flinq > ~/glosano-$(date +%F).dump

# Restore into a running stack
docker compose stop app-api app-worker
docker compose exec -T postgres pg_restore -U flinq -d flinq --clean --if-exists < ~/glosano-2026-10-19.dump
docker compose start app-api app-worker
```

Each learner can also download all of their own data as JSON from their profile.

## 11. Configuration reference

This table describes source-build defaults. The release Compose fixes production mode, defaults to a loopback binding and closed registration, requires a unique database password, and derives the application database URL from it.

All settings are environment variables in `.env`. Changes take effect after `docker compose up -d`.

| Variable | Default | Meaning |
|---|---|---|
| `GLOSANO_ENV` | `prod` | `prod` sends cookies as `Secure` (HTTPS only). `dev` is for local development — and is what `.env.example` sets, so change it. |
| `GLOSANO_SECRET_KEY` | — (required) | Signs sessions. Generate with `openssl rand -hex 32`; changing it signs everyone out. Compose refuses an empty value but not the `.env.example` placeholder — replace it. |
| `GLOSANO_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR`. |
| `GLOSANO_BIND` | `8000` | Host port of `app-api`, or `address:port`. Use `127.0.0.1:8000` behind a proxy. |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | Proxies trusted for `X-Forwarded-*`. `*` is safe while `GLOSANO_BIND` is on `127.0.0.1`. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `flinq` | Used only when the database volume is first created. |
| `GLOSANO_DATABASE_URL` | `postgresql+asyncpg://flinq:flinq@postgres:5432/flinq` | Must match the `POSTGRES_*` values. |
| `GLOSANO_REDIS_URL` | `redis://redis:6379/0` | |
| `GLOSANO_ALLOW_PUBLIC_REGISTRATION` | `true` | `false` rejects new sign-ups; existing accounts keep working. |
| `GLOSANO_INITIAL_ADMIN_EMAIL` | empty | The account registered with this email becomes admin. Email is not verified — prefer `glosano identity create-admin`. |
| `GLOSANO_LLM_ENABLED` | `false` | Turns AI translation and chat on or off. |
| `GLOSANO_LLM_BASE_URL` | — | OpenAI-compatible endpoint, ending in `/v1`. |
| `GLOSANO_LLM_API_KEY` | — | Provider key. Lives only in `.env`. |
| `GLOSANO_LLM_MODEL` | — | Model name as the provider spells it. |
| `GLOSANO_LLM_TIMEOUT_SECONDS` | `30` | Per-request timeout to the provider. |
| `GLOSANO_OCR_ENABLED` / `_BASE_URL` / `_API_KEY` | off | External OCR service that turns PDFs and scans into Markdown. |

## 12. Troubleshooting

**The sign-in form accepts the password but I stay on the sign-in screen.** The browser dropped the `Secure` session cookie because the page was opened over plain HTTP. Open the site through its `https://` address. For a trial on your own machine, `http://localhost:8000` also works.

**"Registration has been disabled by the administrator".** `GLOSANO_ALLOW_PUBLIC_REGISTRATION=false`. Open registration for a moment, or create the account with `glosano identity create-admin` — which makes it an admin.

**"Too many attempts".** Sign-in is limited to 5 tries per 15 minutes per address and email. Wait, or clear the counter:

```bash
docker compose exec redis redis-cli --scan --pattern 'login:*' | xargs -r docker compose exec -T redis redis-cli del
```

**Every visitor shows up with the same IP, or the limit above hits everyone at once.** The proxy's address is not trusted. Set `FORWARDED_ALLOW_IPS=*` (with `GLOSANO_BIND=127.0.0.1:8000`) and run `docker compose up -d`.

**Word cards have no dictionary section.** No dump is loaded for that language pair — see [step 6](#6-load-a-dictionary).

**Word cards have no AI section.** `GLOSANO_LLM_ENABLED` is `false`, or the provider fails: check `docker compose logs app-api | grep -i llm`.

**Imported lessons or YouTube videos never become readable.** The worker is down or cannot reach Redis: `docker compose logs app-worker`.

**`app-api` restarts in a loop after an update.** Usually a missing migration: run `docker compose run --rm app-api alembic upgrade head`.

**`docker compose` says `set GLOSANO_SECRET_KEY in .env`.** `.env` is missing or has no secret key — see [step 3.2](#32-write-env).

---

Glosano is MIT-licensed. Dictionary data comes from Wiktionary via Kaikki.org under CC-BY-SA 4.0.
