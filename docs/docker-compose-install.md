# Install a release with Docker Compose

Requirements: Linux with Docker Engine and Compose **v2.20 or newer**, access to
GHCR, and an HTTPS reverse proxy for access from other devices. Python, Node.js,
Git and a local application build are not required. Docker Swarm is not supported.

Download `compose.yaml` from the chosen GitHub release into an empty installation
directory. Create `.env` there (permissions `600`):

```dotenv
GLOSANO_VERSION=vX.Y.Z
GLOSANO_SECRET_KEY=<openssl rand -hex 32>
POSTGRES_PASSWORD=<openssl rand -hex 24>
GLOSANO_BIND=127.0.0.1:8000
```

Use a **hexadecimal** database password because it is also part of a URL.
Both application roles use this password automatically. Never change it merely
by editing `.env` after the database has been initialized.

```bash
docker compose pull
docker compose up -d --wait --wait-timeout 180
docker compose exec app-api glosano identity create-admin you@example.com
```

The first admin password is printed in your terminal; change it in Settings.
Registration is closed by default. Set `GLOSANO_ALLOW_PUBLIC_REGISTRATION=true`
only if you want other users to sign up. No dictionary or AI provider is needed
to import a text and start reading.

Use the [HTTPS examples](self-hosting.md#4-put-it-behind-https). With a proxy
running on the same host, keep the loopback binding; set `FORWARDED_ALLOW_IPS`
to the trusted proxy address (or `*` only when the published port is isolated
from untrusted clients). A proxy in another container must share a Docker
network with the API, or use a deliberately configured host binding. Do not
expose PostgreSQL or Redis. `http://localhost:8000` is for a local browser trial;
plain HTTP on a LAN IP is not a supported production login address.

`docker compose ps` shows `migrate` as exited **0**, which is expected. API
health is based on `/health/ready`: database reachable, matching schema and
Redis reachable. `/health` alone only confirms a live process. On failure:

```bash
docker compose logs --tail=100 migrate app-api app-worker
```

## Update deliberately

Do not use an unattended container image updater for this stack. Keep a copy
of the old `.env`, Compose file and version before changing anything. Download
and inspect the new release's Compose file; retain the same installation
directory/project name so volumes stay attached. Read release-specific notes.

1. Set the new `GLOSANO_VERSION` in `.env` and download images with
   `docker compose pull`. Existing processes keep running at this point.
2. Stop both writers before backing up and migrating:

   ```bash
   docker compose stop app-api app-worker
   mkdir -p backups
   chmod 700 backups
   (umask 077; docker compose exec -T postgres pg_dump -U glosano -Fc glosano > backups/before-upgrade.dump)
   ```

   Stop if the dump command fails. Preserve a copy off the server. Do not
   overwrite the only backup on subsequent upgrades.
3. Apply the schema and start the new version:

   ```bash
   docker compose run --rm migrate
   docker compose up -d --wait --wait-timeout 180
   ```

4. Verify sign-in, an existing lesson and a new text import before discarding
   any backup. On migration failure, leave API/worker stopped and inspect logs.

## Restore after a failed upgrade

Stop API/worker. Restore the **previous** Compose file and version in `.env`,
keeping the same database credentials and project name. With PostgreSQL running:

```bash
docker compose exec -T postgres pg_restore -U glosano -d glosano \
  --clean --if-exists --exit-on-error --single-transaction < backups/before-upgrade.dump
docker compose up -d --wait --wait-timeout 180
```

This returns user data to the backup time. Switching only the image tag does
not undo migrations. Do not run `docker compose down -v` on a real installation:
it removes data. The PostgreSQL major version is pinned; major database upgrades
require a separate migration procedure and are not part of a normal app update.
