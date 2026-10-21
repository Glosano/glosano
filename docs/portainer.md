# Deploy with Portainer

Supported: **Docker Standalone**, Linux amd64 or arm64, with Compose v2.20+
features. Tested with **Portainer CE 2.45.2**. Docker Swarm and an Unraid Apps
catalog template are outside this guide; an Unraid host can use a compatible
Portainer Docker Standalone environment.

## Create the stack

1. Download `compose.yaml` from a selected
   [Glosano release](https://github.com/Glosano/glosano/releases). Keep the file
   and version together. No Git checkout, application build or installer is needed.
2. Select your Docker Standalone environment in Portainer, then **Stacks → Add
   stack**. Give it a stable name such as `glosano`. Paste the downloaded file
   into **Web editor** (or upload it).
3. Under **Environment variables**, add the following values. These are Stack
   variables, not a `.env` file on the Docker host.

   | Variable | Value |
   |---|---|
   | `GLOSANO_VERSION` | Selected release tag, e.g. `v0.0.1` |
   | `GLOSANO_SECRET_KEY` | Random secret: output of `openssl rand -hex 32` |
   | `POSTGRES_PASSWORD` | Random hexadecimal password: `openssl rand -hex 24` |
   | `GLOSANO_BIND` | `127.0.0.1:8000` for a proxy on the Docker host |
   | `GLOSANO_ALLOW_PUBLIC_REGISTRATION` | `false` (default) |
   | `GLOSANO_LLM_ENABLED` | `false` (default) |

   Generate the secrets on a trusted computer and paste their values. Preserve
   them across redeployments. The database password is also used in a URL, so use
   hex characters. Editing it after database creation does not change the stored
   PostgreSQL password. Leave `COMPOSE_PROJECT_NAME` unset: Portainer owns the
   stack name. GHCR credentials are not required for public release images.
4. Click **Deploy the stack**. The one-shot `migrate` container prepares the
   schema. Exited **0** is its successful final state. API starts only after it
   succeeds; worker starts after API is healthy. PostgreSQL and Redis have no
   published host ports.

## HTTPS and the first administrator

Configure an HTTPS reverse proxy before using Glosano from another device.
Production session cookies are Secure; plain HTTP on a LAN IP will not work.
For a browser running on the Docker host, `http://localhost:8000` is a local trial
option. See the [host proxy examples](self-hosting.md#4-put-it-behind-https).

If the proxy runs in another container, connect it to the stack's Docker network
(normally `glosano_default`) and use `http://app-api:8000` as upstream, never
`localhost`. Portainer's container network controls can join an existing proxy
to that network. Make this membership persistent in the proxy's own deployment. Configure the
proxy to re-resolve Docker service names after container recreation (for nginx,
use Docker's resolver `127.0.0.11` with a variable upstream), or reload it after
redeployment; cached container IPs can otherwise cause a 502 response.
Terminate TLS at the proxy and forward the Host and `X-Forwarded-Proto` headers.
Set `FORWARDED_ALLOW_IPS` to the trusted proxy address; `*` is appropriate only
when the API network/port is isolated from untrusted clients. Keep the loopback
host binding so it does not bypass your proxy.

Open **Containers → glosano-app-api-1 → Console**, connect with `/bin/sh`, and run:

```sh
glosano identity create-admin you@example.com --if-missing
```

Use the generated password at your HTTPS URL, complete onboarding, then change
it in Settings. The password appears in this console, not service logs. Repeating
this command preserves an existing admin's password; it refuses to promote an
existing learner. Do not use `GLOSANO_INITIAL_ADMIN_EMAIL` as an installation
shortcut. Public registration stays closed unless explicitly enabled.

Import a short text and open it; save a word with your own translation. This
works without an AI provider or a dictionary download. An import stuck in
`processing` calls for checking the worker logs.

## Update and recover

Keep the same stack name and named volumes. Save the old Compose file, version
and Stack variables securely. Choose a new version deliberately; do not use an
unattended updater or remove volumes to resolve an upgrade failure.

1. Stop `app-api` and `app-worker` in Portainer **before** taking the backup.
2. In the PostgreSQL container console, create a dump:

   ```sh
   umask 077
   pg_dump -U glosano -Fc glosano > /tmp/before-upgrade.dump
   ```

   Check that it succeeded, then copy it off the container/host before proceeding.
   From a terminal on the Docker host (substitute your actual container name):

   ```sh
   docker cp glosano-postgres-1:/tmp/before-upgrade.dump ./before-upgrade.dump
   chmod 600 ./before-upgrade.dump
   ```

   Store backups outside the stack; a file under `/tmp` in a container is not a
   durable backup. The [Compose guide](docker-compose-install.md#update-deliberately)
   also shows streaming backup commands for terminal users.
3. Open **Stacks → glosano → Editor**, replace the Compose with the selected
   release file, retain your secrets and set its `GLOSANO_VERSION`. Click
   **Update the stack**, enabling image pull. Watch `migrate`, API health and
   worker logs. If migration fails, leave the writers stopped and inspect logs.
4. Verify sign-in, an existing lesson and vocabulary item, and a new import.

For rollback, stop the writers, restore the old file/version/variables, and copy
back the saved dump to the running PostgreSQL container. In its console:

```sh
pg_restore -U glosano -d glosano --clean --if-exists \
  --exit-on-error --single-transaction /tmp/before-upgrade.dump
```

Only after successful restore, update the stack with the old release. An image
rollback alone does not undo schema changes. Never remove the persistent volumes.
Database major-version upgrades need a separate procedure.

## Diagnose a failed deployment

- `migrate` exited nonzero: read its logs; verify database credentials and release
  compatibility. Do not start the API manually around this failure.
- API unhealthy: `/health/ready` requires reachable PostgreSQL/Redis and a schema
  matching the image. `/health` only proves that the process is alive.
- Login returns to the login page: check HTTPS and the proxy address. Do not
  disable Secure cookies or switch the service to development mode.
- Images cannot be pulled: check access from the Docker host to GHCR and the
  exact release tag. A release contains both amd64 and arm64 images.

Validation used a real Portainer Stack created from Compose text and its Env
fields, with no host `.env`: initial migration, CLI admin, verified HTTPS login,
worker import, vocabulary save, redeploy and database backup/restore. Concurrent
migration, failure/readiness and preceding-schema upgrade checks run separately
against the same Compose contract in release CI.
