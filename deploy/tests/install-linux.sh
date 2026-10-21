#!/usr/bin/env bash
# Run the real installer in Linux against a disposable local image registry.
set -euo pipefail
cd "$(dirname "$0")/../.."
image=${1:?Usage: install-linux.sh IMAGE:TAG}
run_id="glosano-install-test-$(date +%s)-$$"
test_dir=$(mktemp -d)
project=
cleanup() {
  result=$?
  if [[ -f $test_dir/instance/.env ]]; then
    project=$(awk -F= '$1=="COMPOSE_PROJECT_NAME" {print $2}' "$test_dir/instance/.env")
    docker compose -p "$project" -f "$test_dir/instance/compose.yaml" --env-file "$test_dir/instance/.env" down -v >/dev/null || true
  fi
  docker rm -f "$run_id-registry" >/dev/null 2>&1 || true
  rm -rf "$test_dir"
  exit "$result"
}
trap cleanup EXIT
docker build -f deploy/tests/installer.Dockerfile -t glosano-installer-test .
docker run -d --name "$run_id-registry" -p 127.0.0.1::5000 registry:2 >/dev/null
registry_port=$(docker port "$run_id-registry" 5000/tcp | sed 's/.*://')
registry="localhost:$registry_port/glosano"
docker tag "$image" "$registry:v0.0.0"
for _attempt in {1..30}; do
  if curl -fsS "http://localhost:$registry_port/v2/" >/dev/null 2>&1; then break; fi
  sleep 1
done
docker push "$registry:v0.0.0" >/dev/null
deploy/package-release.sh v0.0.0 "$test_dir/assets"
sed "s|ghcr.io/glosano/glosano|$registry|g" "$test_dir/assets/compose.yaml" > "$test_dir/compose.yaml"
mv "$test_dir/compose.yaml" "$test_dir/assets/compose.yaml"
(cd "$test_dir/assets" && sha256sum install.sh compose.yaml > SHA256SUMS)
mkdir "$test_dir/bin" "$test_dir/instance"
# Only release downloads use fixtures. Docker pulls, Compose, migrations,
# administrator creation and the public readiness request are all real.
cat > "$test_dir/bin/curl" <<'SH'
#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    https://github.com/Glosano/glosano/releases/download/v0.0.0/*)
      asset=${arg##*/}
      while (( $# )); do
        if [[ $1 == -o ]]; then cp "/assets/$asset" "$2"; exit; fi
        shift
      done
      exit 1;;
  esac
done
exec /usr/bin/curl "$@"
SH
chmod +x "$test_dir/bin/curl"
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
run_installer() {
  docker run --rm --network host \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$test_dir/assets:/assets:ro" -v "$test_dir/bin:/test-bin:ro" \
    -v "$test_dir/instance:/instance" \
    -e PATH=/test-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    -e GLOSANO_INSTALL_DIR=/instance -e GLOSANO_ADMIN_EMAIL=owner@example.com \
    -e "GLOSANO_BIND=127.0.0.1:$port" -e "GLOSANO_URL=http://localhost:$port" \
    glosano-installer-test bash /assets/install.sh
}
run_installer
before=$(sha256sum "$test_dir/instance/.env")
run_installer
[[ $(sha256sum "$test_dir/instance/.env") == "$before" ]]
printf '%s\n' 'PASS: real Linux installer, registry pulls, admin bootstrap and idempotent retry'
