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
[backup/update procedure](docker-compose-install.md#update-deliberately).
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
