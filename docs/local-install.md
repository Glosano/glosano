# Run Glosano on your computer

Glosano runs locally in Docker and opens in your browser at **http://localhost:8000**.
No domain, certificate, reverse proxy, Git checkout or application build is needed.
Your lessons, vocabulary and progress stay in Docker volumes on this computer.

## 1. Start Docker

- **macOS:** install and start Docker Desktop (Apple Silicon and Intel supported).
- **Windows:** install and start Docker Desktop using **Linux containers**. Run the
  command below in ordinary PowerShell; no WSL terminal is needed.
- **Linux:** start Docker Engine and ensure your account can run `docker info`.

Docker Compose v2.20+ is required; Docker Desktop includes Compose. Docker itself
is a prerequisite, not something the Glosano installer installs for you.

## 2. Install

macOS / Linux:

```bash
curl -fsSL https://github.com/Glosano/glosano/releases/latest/download/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://github.com/Glosano/glosano/releases/latest/download/install.ps1 | iex
```

Choose an installation directory, enter an admin email (for example
`you@example.com`), and keep the default URL `http://localhost:8000`. The email is
an account identifier; no email is sent. Wait for the images to download and the
services to become ready. Copy the generated password from the terminal.

Prefer to read the installer first? Download `install.sh` or `install.ps1` from
[the chosen release](https://github.com/Glosano/glosano/releases), inspect it and
run `bash install.sh` or `powershell -ExecutionPolicy Bypass -File .\install.ps1`.
Use matching assets and image versions; the installer verifies the Compose checksum.

## 3. Open and use

Open **http://localhost:8000** on this same computer, sign in with the email and
printed password, select your native and learning languages, and change your
password in Settings. Import a `.txt`/`.md` file or paste a short text and start
reading. AI keys and dictionary downloads are optional.

The installer configures a loopback-only binding and `GLOSANO_LOCAL_HTTP=true`.
This makes login work over HTTP, including in Safari. Keep that binding: this is
not a configuration for other computers on your network. For shared access use
the [HTTPS server guide](self-hosting.md) and `GLOSANO_LOCAL_HTTP=false`.

## Stop, start and keep your data

Run these commands **inside your installation directory**, where `compose.yaml`
and `.env` were created:

```sh
docker compose stop
docker compose up -d --wait
```

Closing the browser does not stop Docker. Restart policies bring the services
back when Docker restarts; they do not start Docker Desktop itself. Keep Docker
running whenever you want to use Glosano.

Re-running the installer from the **same release** resumes an interrupted setup
without replacing secrets, resetting an existing admin password, or deleting
volumes. An update is a separate operation: follow the
[one-command update](docker-update.md).
Never use `docker compose down -v` to restart: `-v` deletes the stored data.

## Another port

If port 8000 is occupied, choose a URL such as `http://localhost:8010` when asked.
The installer uses that port automatically. For a noninteractive setup:

```bash
GLOSANO_INSTALL_DIR="$HOME/glosano" GLOSANO_ADMIN_EMAIL=you@example.com \
GLOSANO_URL=http://localhost:8010 bash install.sh
```

```powershell
$env:GLOSANO_INSTALL_DIR = "$HOME\glosano"
$env:GLOSANO_ADMIN_EMAIL = 'you@example.com'
$env:GLOSANO_URL = 'http://localhost:8010'
.\install.ps1
```

If you also set `GLOSANO_BIND`, it must be `127.0.0.1` with the same port.
For an existing installation, edit the port in `.env` (`GLOSANO_BIND` and
`GLOSANO_INSTALL_URL`) and run `docker compose up -d --wait`.

## Troubleshooting

- **Docker unavailable:** start Docker Desktop/Engine and check `docker info`.
  On Windows select Linux containers.
- **Browser stays on login:** use the printed localhost URL; check that `.env`
  contains `GLOSANO_LOCAL_HTTP=true`, then run `docker compose up -d --wait`.
- **Startup failed:** run `docker compose logs --tail=100 migrate app-api app-worker`.
  An exited `migrate` container with code 0 is normal: it has finished preparing the DB.
- **Installation was interrupted:** re-run the same release installer. If it reports
  `.install.lock`, first confirm no installer is still running before removing that
  empty lock directory. Keep `.env`, Compose and the volumes.
- **Forgotten password:** use `docker compose exec app-api glosano identity --help`
  for the password reset command; do not reinstall over the data.


## Configure AI in the browser

After signing in and completing onboarding, open the account menu → **Settings → AI settings**
(`/settings/ai`). Only administrators see the AI settings tab. Choose a preset (OpenAI,
OpenRouter, Ollama, LM Studio or another OpenAI-compatible server), enter the
server address, API key if needed, and model identifier. **Load models** is optional;
a server without `/models` still works with a manually entered identifier.

**Test connection** sends a small diagnostic request and may incur a provider
charge. It tests the draft without replacing the active connection. Enable AI and
save to apply the connection to translations, chat and AI practice without
restarting API or worker. You can also save valid settings when the provider is
unavailable, or skip AI entirely. The base reader, vocabulary and review remain usable.

For a model running on the Docker host, use `http://host.docker.internal:11434/v1`
(Ollama) or `http://host.docker.internal:1234/v1` (LM Studio), not container-local
`localhost`. The supplied Compose files include the host gateway mapping for Linux.
The model server must already be running and listening on an interface reachable
from Docker; allow access only from the intended local network. A model in another
container can use its service name on a shared Docker network. Public endpoints
require HTTPS. Glosano does not install inference servers or download models.

### Existing installations and emergency disable

Before the first save in the admin panel, existing `GLOSANO_LLM_ENABLED`,
`GLOSANO_LLM_BASE_URL`, `GLOSANO_LLM_API_KEY` and `GLOSANO_LLM_MODEL` values keep
working. The form identifies this source as **Environment**. Saving explicitly
moves the complete connection to PostgreSQL; it can retain the existing key without
revealing it to the browser. After that, these four legacy variables no longer
override the saved connection, including `GLOSANO_LLM_ENABLED=false`. Clearing a
saved key does not bring back the old environment key. Changing servers requires
entering a key for the new server or explicitly choosing no key.

To prohibit **all** AI requests, including diagnostics and model listing, set
`GLOSANO_LLM_FORCE_DISABLED=true` in `.env` or Portainer Stack variables and recreate
both API and worker using your installation's Compose file. The admin panel cannot
override this flag. Its default is false. The normal **Enable AI** control applies
without a restart; diagnostics remain available while normal AI is off unless the
force-disable flag is set. Requests already sent to a provider cannot be recalled;
new calls and retries are blocked, and active chat streaming is stopped.

### Keys, updates and recovery

The API key is encrypted in PostgreSQL using a key derived from the existing
`GLOSANO_SECRET_KEY`. Installers generate that instance secret automatically.
Never replace it during an update. Keep a protected copy of the original instance
secret separately from the database backup: restoring the database alone does not
recover the encrypted provider key. After losing or changing the instance secret,
AI fails closed and an administrator must re-enter or remove the provider key in
**AI settings**. Saved learning data remains intact. A known default or unsuitable
instance secret must be replaced with a strong random secret before storing an API key.

Use the existing backup/restore procedure to roll back a schema upgrade; do not
simply downgrade the image after saving AI settings. Removing the settings table
could reactivate obsolete environment credentials. The migration refuses a direct
downgrade if persisted settings or new provider-specific translations exist.
