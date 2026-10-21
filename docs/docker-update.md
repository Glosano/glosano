# Update Glosano without losing your data

Start Docker and open a terminal **in your existing installation directory**
(the directory containing `.env`, `compose.yaml` and `.glosano-install`).

macOS / Linux:

```bash
curl -fsSL https://github.com/Glosano/glosano/releases/latest/download/update.sh | bash
```

Windows PowerShell:

```powershell
irm https://github.com/Glosano/glosano/releases/latest/download/update.ps1 | iex
```

The updater downloads the latest stable release, makes a backup, applies database
migrations and starts the new application. Your accounts, passwords, lessons,
vocabulary, progress, files and saved settings stay in the same installation.
The application is briefly unavailable while the backup and migrations run.
Allow enough free disk space for the downloaded image and a backup of all data.

To select a release, replace `latest/download` with `download/vX.Y.Z` in the URL.
You can download and inspect the script before executing it. No Git, Python,
Node.js, build or WSL terminal is required. Docker Compose v2.20+ is required.
To run from another directory, set `GLOSANO_INSTALL_DIR` to the installation path.

## What is preserved

The updater changes only the release version in `.env` and installs the matching
release Compose file. It keeps the Compose project name, volume names, secrets,
admin credentials, port, local HTTP/HTTPS mode and provider settings. Exported
shell variables cannot override saved configuration. It never creates a new admin
or removes volumes. PostgreSQL and Redis containers are left running and are not
upgraded by this command.

Each update creates a private directory under `backups/update-<timestamp>-<id>`:

- `database.dump`: PostgreSQL custom-format dump, checked with `pg_restore --list`.
- `app-data.tar.gz`: files from the application data volume.
- `redis.rdb`: Redis snapshot, including queued work and sessions.
- `.env`, `compose.yaml`, `.glosano-install`: previous configuration and version.
- `SHA256SUMS`, `BACKUP_COMPLETE`, `status`: integrity manifest and recovery state.

Both API and worker are stopped before the snapshots, so no application process
writes during the backup. Keep the backup private: it contains credentials and
personal data. Copy it off the machine if you need protection against disk loss.
Backups are retained; remove older ones yourself after verifying the new release.

Running the command again on the installed version only checks readiness.
Downgrades require restoration. The automatic path supports installations made
by the Glosano installer with an unchanged release Compose file and bundled
PostgreSQL/Redis. Custom Compose files, overrides, external Redis, infrastructure
changes and [Portainer stacks](portainer.md) use the
[manual update procedure](docker-compose-install.md#update-deliberately).

## If an update fails

- **Download, checksum or compatibility failure:** the existing app keeps running.
  Resolve the reported problem and retry. Do not remove compatibility checks.
- **Backup failure:** the old app is restarted; configuration is unchanged.
  An incomplete backup is retained for diagnosis and must not be used for recovery.
- **Migration or startup failure:** API/worker are stopped. `.glosano-update` points
  to the backup and further installer/updater runs are blocked. Inspect
  `docker compose logs --tail=100 app-api app-worker` and the updater's terminal
  output (the migration runs in a temporary container). Restore the previous
  release as below, or follow a release-specific repair procedure.
- **Power loss / forced termination:** inspect `.glosano-update` and the backup's
  `status`. Never assume a migration did not run. Remove `.install.lock` only after
  confirming no installer/updater or migration process is still running.

If `status` is `backing-up` and `BACKUP_COMPLETE` is absent, migrations have not
started. Keep the original configuration, restart API/worker with
`docker compose up -d --no-deps --wait app-api app-worker`, verify readiness,
then remove `.glosano-update`. If the configuration/version is inconsistent or
there is any doubt about migration progress, stop and inspect before resuming.

## Restore a complete backup

Restoration replaces current application data with the selected snapshot; changes
made after that snapshot are lost. Switching only the image tag does **not** undo
migrations. These commands restore an installer-managed stack using the bundled
PostgreSQL 16 and Redis 7. Do not use `docker compose down -v`.

Run in the installation directory, with no `GLOSANO_*`, `POSTGRES_*` or `COMPOSE_*`
exports overriding `.env`. Ensure no updater or migration is running. Choose the
backup from `.glosano-update` (or a previously completed update).

Bash:

```bash
backup=$(cat .glosano-update)
test -f "$backup/BACKUP_COMPLETE" || exit 1
(cd "$backup" && shasum -a 256 -c SHA256SUMS) || exit 1
docker compose stop app-api app-worker
cp "$backup/.env" .env
cp "$backup/compose.yaml" compose.yaml
cp "$backup/.glosano-install" .glosano-install
```

PowerShell:

```powershell
$ErrorActionPreference = 'Stop'
$backup = (Get-Content -Raw .glosano-update).Trim()
if (!(Test-Path "$backup/BACKUP_COMPLETE")) { throw 'Incomplete backup' }
Get-Content "$backup/SHA256SUMS" | ForEach-Object {
    $hash, $name = $_ -split '\s+', 2
    if ((Get-FileHash -Algorithm SHA256 "$backup/$name").Hash -ne $hash) { throw "Checksum failed: $name" }
}
docker compose stop app-api app-worker
if ($LASTEXITCODE) { throw 'Stop failed' }
Copy-Item -Force "$backup/.env" .env
Copy-Item -Force "$backup/compose.yaml" compose.yaml
Copy-Item -Force "$backup/.glosano-install" .glosano-install
```

Then run the following commands in either shell, **one at a time**, stopping on
any error (in PowerShell, check `$LASTEXITCODE` after each Docker command).
Do not start API/worker until every store is restored. Keep the same project name.
The temporary recovery container names below must be unused. The database is
recreated so objects introduced by a failed migration are also removed.

```sh
docker compose up -d --no-deps --wait postgres
docker compose cp "$backup/database.dump" postgres:/tmp/glosano-restore.dump
docker compose exec -T postgres pg_restore --list /tmp/glosano-restore.dump
docker compose exec -T postgres dropdb -U glosano --force glosano
docker compose exec -T postgres createdb -U glosano -O glosano glosano
docker compose exec -T postgres pg_restore -U glosano -d glosano --exit-on-error --single-transaction /tmp/glosano-restore.dump
docker compose exec -T postgres rm -f /tmp/glosano-restore.dump

docker compose run --name glosano-restore-files --no-deps -d --entrypoint sleep app-api infinity
docker cp "$backup/app-data.tar.gz" glosano-restore-files:/tmp/app-data.tar.gz
docker exec glosano-restore-files python -c "import pathlib,shutil,tarfile; p=pathlib.Path('/var/lib/glosano'); [(shutil.rmtree(x) if x.is_dir() and not x.is_symlink() else x.unlink()) for x in p.iterdir()]; tarfile.open('/tmp/app-data.tar.gz').extractall(p,filter='data')"
docker rm -f glosano-restore-files

docker compose stop redis
docker compose run --name glosano-restore-redis --no-deps -d --entrypoint sleep redis infinity
docker cp "$backup/redis.rdb" glosano-restore-redis:/data/dump.rdb
docker exec glosano-restore-redis chown redis:redis /data/dump.rdb
docker rm -f glosano-restore-redis
docker compose up -d --no-deps --wait redis

docker compose up -d --no-deps --wait --wait-timeout 180 app-api
docker compose up -d --no-deps --wait --wait-timeout 180 app-worker
```

Sign in at the saved URL and verify an existing lesson, vocabulary and a new
import. Only after successful recovery remove `.glosano-update` and any stale
`.install.lock`. Keep the backup. This procedure uses `docker cp` for binary files
so it also works in Windows PowerShell 5.1, whose native stdout redirection would
corrupt a PostgreSQL dump or archive.
