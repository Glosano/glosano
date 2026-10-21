#!/usr/bin/env bash
# Published per release; __VERSION__ is replaced when packaging release assets.
set -euo pipefail
umask 077
version=__VERSION__
fail() { printf 'Glosano: %s\n' "$*" >&2; exit 1; }
prompt() {
  local label=$1 default=$2 answer
  [[ -r /dev/tty ]] || fail "No terminal. Set GLOSANO_INSTALL_DIR, GLOSANO_ADMIN_EMAIL and GLOSANO_URL."
  printf '%s [%s]: ' "$label" "$default" > /dev/tty
  read -r answer < /dev/tty || fail 'Input cancelled.'
  printf '%s' "${answer:-$default}"
}
[[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Use install.sh from a published release.'
case $(uname -s) in
  Linux|Darwin) ;;
  *) fail 'Use install.ps1 in PowerShell on Windows, or install.sh on macOS/Linux.' ;;
esac
for tool in docker curl openssl awk; do
  command -v "$tool" >/dev/null || fail "Install $tool first."
done
if command -v sha256sum >/dev/null; then
  checksum=(sha256sum)
elif command -v shasum >/dev/null; then
  checksum=(shasum -a 256)
else
  fail 'Install sha256sum or shasum first.'
fi
docker info >/dev/null 2>&1 || fail 'Docker is unavailable to this user. Start Docker and check permissions.'
compose_version=$(docker compose version --short) || fail 'Install Docker Compose v2.20 or newer.'
compose_version=${compose_version#v}
IFS=. read -r major minor _ <<< "$compose_version"
[[ $major =~ ^[0-9]+$ && $minor =~ ^[0-9]+$ ]] || fail 'Cannot determine Compose version.'
(( major > 2 || (major == 2 && minor >= 20) )) || fail 'Docker Compose v2.20 or newer is required.'
install_dir=${GLOSANO_INSTALL_DIR:-}
[[ -n $install_dir ]] || install_dir=$(prompt 'Installation directory' "$PWD/glosano")
[[ -n $install_dir ]] || fail 'An installation directory is required.'
mkdir -p "$install_dir"
cd "$install_dir"
[[ ! -L .env && ! -L compose.yaml && ! -L .glosano-install ]] || fail 'Managed files must not be symbolic links.'
[[ ! -e .glosano-update && ! -L .glosano-update ]] || fail 'An unfinished update needs recovery; see docs/docker-update.md.'
if [[ ! -f .glosano-install ]]; then
  [[ -z $(find . -mindepth 1 -maxdepth 1 -print -quit) ]] || fail 'Choose an empty directory; existing files will not be overwritten.'
  printf '%s\n' "$version" > .glosano-install
fi
[[ $(cat .glosano-install) == "$version" ]] || fail 'This directory belongs to another release. Follow the documented update procedure.'
mkdir .install.lock 2>/dev/null || fail 'Another installer is running (or .install.lock remains after an interrupted process).'
staging=$(mktemp -d .install.XXXXXXXX)
cleanup() { rm -rf "$staging"; rmdir .install.lock; }
trap cleanup EXIT
value() { awk -F= -v key="$1" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' .env; }
if [[ -f .env ]]; then
  [[ $(value GLOSANO_VERSION) == "$version" ]] || fail 'Configured version differs. Use the update procedure.'
  email=$(value GLOSANO_INSTALL_ADMIN_EMAIL)
  url=$(value GLOSANO_INSTALL_URL)
else
  email=${GLOSANO_ADMIN_EMAIL:-}
  [[ -n $email ]] || email=$(prompt 'Administrator email' '')
  # Full validation is performed by the application before creating the account.
  [[ $email =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fail 'Enter a valid administrator email.'
  url=${GLOSANO_URL:-}
  [[ -n $url ]] || url=$(prompt 'Application URL (local HTTP or server HTTPS)' 'http://localhost:8000')
  url=${url%/}
  [[ $url =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ || $url =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]] || fail 'Use http://localhost:PORT (or 127.0.0.1) or an HTTPS origin, without a path.'
  local_http=false
  default_bind=127.0.0.1:8000
  if [[ $url == http://* ]]; then
    local_http=true
    authority=${url#http://}
    url_port=80
    [[ $authority != *:* ]] || url_port=${authority##*:}
    default_bind=127.0.0.1:$url_port
  fi
  bind=${GLOSANO_BIND:-$default_bind}
  [[ $bind =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}:([0-9]{1,5})$ ]] || fail 'GLOSANO_BIND must be IPv4:PORT.'
  port=${bind##*:}
  (( 10#$port >= 1 && 10#$port <= 65535 )) || fail 'Port must be between 1 and 65535.'
  if [[ $local_http == true ]]; then
    [[ $bind == 127.0.0.1:* ]] || fail 'Local HTTP must bind to 127.0.0.1, not the network.'
    [[ $port == "$url_port" ]] || fail 'The local URL port must match GLOSANO_BIND.'
  fi
  host=${bind%:*}
  [[ $host != 0.0.0.0 ]] || host=127.0.0.1
  if (echo > "/dev/tcp/$host/$port") >/dev/null 2>&1; then
    fail "Port $bind is occupied. Choose GLOSANO_BIND and a matching URL."
  fi
  secret=$(openssl rand -hex 32)
  password=$(openssl rand -hex 24)
  project="glosano-$(openssl rand -hex 4)"
  cat > "$staging/env" <<ENV
COMPOSE_PROJECT_NAME=$project
GLOSANO_VERSION=$version
GLOSANO_SECRET_KEY=$secret
POSTGRES_PASSWORD=$password
GLOSANO_BIND=$bind
GLOSANO_LOCAL_HTTP=$local_http
GLOSANO_ALLOW_PUBLIC_REGISTRATION=false
GLOSANO_LLM_ENABLED=false
GLOSANO_INSTALL_ADMIN_EMAIL=$email
GLOSANO_INSTALL_URL=$url
ENV
  mv "$staging/env" .env
fi
[[ -n $email && -n $url ]] || fail 'Installer metadata is missing from .env; restore it before resuming.'
base="https://github.com/Glosano/glosano/releases/download/$version"
for asset in compose.yaml SHA256SUMS; do
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "$base/$asset" -o "$staging/$asset" || fail "Could not download $asset. Re-run to resume."
done
awk '$2 == "compose.yaml" {print}' "$staging/SHA256SUMS" > "$staging/compose.sha256"
[[ -s $staging/compose.sha256 ]] || fail 'Release checksum for compose.yaml is missing.'
(cd "$staging" && "${checksum[@]}" -c compose.sha256) || fail 'Compose checksum verification failed.'
if [[ -f compose.yaml ]]; then
  cmp -s compose.yaml "$staging/compose.yaml" || fail 'Existing Compose differs; refusing to overwrite local changes.'
else
  mv "$staging/compose.yaml" compose.yaml
fi
# Persisted settings win over unrelated variables exported by the calling shell.
unset COMPOSE_PROJECT_NAME GLOSANO_VERSION GLOSANO_IMAGE GLOSANO_SECRET_KEY POSTGRES_PASSWORD
unset GLOSANO_BIND GLOSANO_LOCAL_HTTP GLOSANO_ALLOW_PUBLIC_REGISTRATION GLOSANO_LLM_ENABLED
compose=(docker compose --project-directory "$PWD" -f "$PWD/compose.yaml" --env-file "$PWD/.env")
"${compose[@]}" config --quiet
"${compose[@]}" pull
"${compose[@]}" up -d --wait --wait-timeout 180 || fail 'Startup failed. Inspect docker compose logs migrate app-api app-worker, then re-run.'
"${compose[@]}" exec -T app-api glosano identity create-admin "$email" --if-missing
# A running container is not enough when the public proxy points elsewhere.
curl --fail --silent --show-error --location --max-time 20 "$url/health/ready" \
  | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"' \
  || fail "Local services are ready, but $url is not reachable and ready from this machine. Check the URL and Docker port (or HTTPS proxy for a server); re-run after fixing it."
printf '\nGlosano %s is ready at %s\nInstallation: %s\nChange the initial password in Settings.\n' "$version" "$url" "$PWD"
