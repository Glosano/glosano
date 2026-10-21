#!/usr/bin/env bash
# Published per release; __VERSION__ selects the matching target image and assets.
# Parse the whole piped script before Docker can consume its stdin.
{
set -euo pipefail
umask 077
version=__VERSION__
fail() { printf 'Glosano: %s\n' "$*" >&2; exit 1; }
[[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Use update.sh from a published release.'
case $(uname -s) in Linux|Darwin) ;; *) fail 'Use update.ps1 on Windows.' ;; esac
for tool in docker curl awk openssl; do command -v "$tool" >/dev/null || fail "Install $tool first."; done
if command -v sha256sum >/dev/null; then checksum=(sha256sum); else checksum=(shasum -a 256); fi
docker info >/dev/null 2>&1 || fail 'Docker is unavailable. Start Docker first.'
compose_version=$(docker compose version --short)
compose_version=${compose_version#v}
IFS=. read -r major minor _ <<< "$compose_version"
[[ $major =~ ^[0-9]+$ && $minor =~ ^[0-9]+$ ]] && (( major > 2 || (major == 2 && minor >= 20) )) || fail 'Docker Compose v2.20+ is required.'
install_dir=${GLOSANO_INSTALL_DIR:-$PWD}
[[ -d $install_dir ]] || fail 'Run inside the installation directory, or set GLOSANO_INSTALL_DIR.'
cd "$install_dir"
for file in .env compose.yaml .glosano-install; do
  [[ -f $file && ! -L $file ]] || fail 'This is not a managed installer directory (or a managed file is a symlink).'
done
for file in compose.override.yml compose.override.yaml docker-compose.override.yml docker-compose.override.yaml; do
  [[ ! -e $file && ! -L $file ]] || fail 'Compose overrides need the manual update procedure.'
done
[[ ! -e .glosano-update && ! -L .glosano-update ]] || fail 'An unfinished update needs recovery. See .glosano-update and docs/docker-update.md.'
mkdir .install.lock 2>/dev/null || fail 'Another installer/updater is running (or .install.lock remains after interruption).'
staging= backup= backup_container= stopped=false migrating=false
finish() {
  result=$?
  trap - EXIT
  set +e
  if (( result != 0 )) && [[ $stopped == true ]]; then
    if [[ $migrating == false ]]; then
      if "${old_compose[@]}" up -d --no-deps --wait --wait-timeout 180 app-api app-worker; then
        rm -f .glosano-update
        printf '%s\n' 'Backup failed; the previous application has been restarted.' >&2
      else
        printf '%s\n' 'Could not restart the previous application. Inspect logs and the recovery marker.' >&2
      fi
    else
      "${new_compose[@]}" stop --timeout 60 app-api app-worker
      printf 'Update failed after migration may have begun. Application stopped. Backup: %s\nSee docs/docker-update.md; do not rerun or switch only the image tag.\n' "$backup" >&2
    fi
  fi
  [[ -z $backup_container ]] || docker rm "$backup_container" >/dev/null 2>&1
  [[ -z $staging ]] || rm -rf "$staging"
  rmdir .install.lock
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
[[ ! -e .glosano-update && ! -L .glosano-update ]] || fail 'An unfinished update needs recovery; see docs/docker-update.md.'
value() {
  [[ $(awk -F= -v key="$1" '$1==key {n++} END {print n+0}' .env) == 1 ]] || fail "Missing or duplicate $1 in .env."
  awk -v key="$1" 'index($0,key "=")==1 {sub(/^[^=]*=/, ""); sub(/\r$/, ""); print}' .env
}
source_version=$(value GLOSANO_VERSION)
project=$(value COMPOSE_PROJECT_NAME)
url=$(value GLOSANO_INSTALL_URL)
[[ $source_version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ && $(tr -d '\r\n' < .glosano-install) == "$source_version" ]] || fail 'Installed version and marker disagree; use the manual update procedure.'
[[ $project =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'Invalid saved Compose project name.'
[[ $url =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ || $url =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]] || fail 'Invalid saved application URL.'
# Shell exports must never replace persisted settings, including provider secrets.
while IFS='=' read -r name _; do
  case $name in GLOSANO_*|POSTGRES_*|COMPOSE_*|FORWARDED_ALLOW_IPS) unset "$name" ;; esac
done < <(env)
old_compose=(docker compose --project-directory "$PWD" -p "$project" -f "$PWD/compose.yaml" --env-file "$PWD/.env")
ready() { curl -fsSL --max-time 20 "$url/health/ready" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"'; }
if [[ $source_version == "$version" ]]; then
  ready || fail 'Already on this version, but the application is not ready. Inspect Docker logs.'
  printf 'Glosano %s is already installed; no changes made.\n' "$version"
  exit 0
fi
IFS=. read -r -a old_parts <<< "${source_version#v}"
IFS=. read -r -a new_parts <<< "${version#v}"
for index in 0 1 2; do
  (( 10#${new_parts[$index]} >= 10#${old_parts[$index]} )) || fail 'Downgrades require the restore procedure, not the updater.'
  if (( 10#${new_parts[$index]} > 10#${old_parts[$index]} )); then break; fi
done
staging=$(mktemp -d "$PWD/.update.XXXXXXXX")
base=https://github.com/Glosano/glosano/releases/download
for asset in compose.yaml SHA256SUMS update-check.py; do
  curl -fsSL --retry 3 "$base/$version/$asset" -o "$staging/$asset" || fail "Cannot download $asset; the running installation was not changed."
done
curl -fsSL --retry 3 "$base/$source_version/SHA256SUMS" -o "$staging/old-SHA256SUMS"
verify() {
  local manifest=$1 asset=$2 path=$3 expected actual
  [[ $(awk -v asset="$asset" '$2==asset {n++} END {print n+0}' "$manifest") == 1 ]] || fail "Missing or ambiguous checksum: $asset"
  expected=$(awk -v asset="$asset" '$2==asset {print $1}' "$manifest")
  actual=$("${checksum[@]}" "$path" | awk '{print $1}')
  [[ $expected == "$actual" ]] || fail "Checksum mismatch: $asset. Local Compose customizations require manual updates."
}
verify "$staging/old-SHA256SUMS" compose.yaml compose.yaml
verify "$staging/SHA256SUMS" compose.yaml "$staging/compose.yaml"
verify "$staging/SHA256SUMS" update-check.py "$staging/update-check.py"
awk -v version="$version" '/^GLOSANO_VERSION=/ {$0="GLOSANO_VERSION=" version} {print}' .env > "$staging/.env"
new_compose=(docker compose --project-directory "$PWD" -p "$project" -f "$staging/compose.yaml" --env-file "$staging/.env")
old_json=$("${old_compose[@]}" config --format json)
new_json=$("${new_compose[@]}" config --format json)
printf '{"source":"%s","target":"%s","old":%s,"new":%s}' "$source_version" "$version" "$old_json" "$new_json" \
  | docker run --rm --pull never -i --entrypoint python "ghcr.io/glosano/glosano:$source_version" -c "$(cat "$staging/update-check.py")"
[[ -z $("${old_compose[@]}" ps --status running -q migrate) ]] || fail 'A migration is already running.'
for role in app-api app-worker postgres redis; do
  container=$("${old_compose[@]}" ps --status running -q "$role")
  [[ -n $container ]] || fail "Start the existing $role service before updating."
  if [[ $role == app-* ]]; then
    [[ $(docker inspect --format '{{.Config.Image}}' "$container") == "ghcr.io/glosano/glosano:$source_version" ]] || fail 'Running app image differs from .env; reconcile the installation manually.'
  fi
done
ready || fail 'The existing application is not ready; fix it before updating.'
printf 'Downloading Glosano %s before stopping the application...\n' "$version"
"${new_compose[@]}" pull migrate app-api app-worker
[[ ! -L backups ]] || fail 'The backups directory must not be a symlink.'
mkdir -p backups
chmod 700 backups
backup="backups/update-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
mkdir "$backup"
cp .env compose.yaml .glosano-install "$backup/"
printf '%s\n' "$backup" > .glosano-update
printf 'backing-up\n' > "$backup/status"
stopped=true
"${old_compose[@]}" stop --timeout 60 app-api app-worker
printf 'Creating a private backup in %s...\n' "$backup"
dump="/tmp/glosano-update-$(openssl rand -hex 8).dump"
"${old_compose[@]}" exec -T postgres pg_dump -U glosano -Fc -f "$dump" glosano
"${old_compose[@]}" exec -T postgres pg_restore --list "$dump" >/dev/null
"${old_compose[@]}" cp "postgres:$dump" "$backup/database.dump"
"${old_compose[@]}" exec -T postgres rm -f "$dump"
[[ $("${old_compose[@]}" exec -T redis redis-cli SAVE | tr -d '\r\n') == OK ]] || fail 'Redis snapshot failed.'
"${old_compose[@]}" cp redis:/data/dump.rdb "$backup/redis.rdb"
backup_container="glosano-backup-$(openssl rand -hex 8)"
"${old_compose[@]}" run --name "$backup_container" --no-deps -T --entrypoint python app-api -c \
  "import tarfile; a=tarfile.open('/tmp/app-data.tar.gz','w:gz'); a.add('/var/lib/glosano',arcname='.'); a.close()"
docker cp "$backup_container:/tmp/app-data.tar.gz" "$backup/app-data.tar.gz"
docker rm "$backup_container" >/dev/null
backup_container=
for file in database.dump redis.rdb app-data.tar.gz; do [[ -s $backup/$file ]] || fail "Empty backup: $file"; done
(cd "$backup" && "${checksum[@]}" .env compose.yaml .glosano-install database.dump redis.rdb app-data.tar.gz > SHA256SUMS)
printf 'complete\n' > "$backup/BACKUP_COMPLETE"
# From here onward an interruption requires explicit recovery, never a fresh backup.
printf 'migrating\n' > "$backup/status"
migrating=true
cp "$staging/.env" .env
cp "$staging/compose.yaml" compose.yaml
chmod 600 .env
new_compose=(docker compose --project-directory "$PWD" -p "$project" -f "$PWD/compose.yaml" --env-file "$PWD/.env")
"${new_compose[@]}" run --rm --no-deps -T migrate
printf 'starting\n' > "$backup/status"
"${new_compose[@]}" up -d --no-deps --wait --wait-timeout 180 app-api
"${new_compose[@]}" up -d --no-deps --wait --wait-timeout 180 app-worker
ready || fail "Updated services are not ready at $url."
printf '%s\n' "$version" > .glosano-install
printf 'complete\n' > "$backup/status"
rm .glosano-update
printf '\nGlosano updated from %s to %s at %s\nBackup retained: %s/%s\n' "$source_version" "$version" "$url" "$PWD" "$backup"
} </dev/null
