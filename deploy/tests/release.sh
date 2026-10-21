#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
image="${1:?Usage: release.sh IMAGE:TAG}"
export GLOSANO_IMAGE="${image%:*}" GLOSANO_VERSION="${image##*:}"
export GLOSANO_SECRET_KEY=release-test-only-secret POSTGRES_PASSWORD=abcdef0123456789
export GLOSANO_BIND=127.0.0.1:0 GLOSANO_ALLOW_PUBLIC_REGISTRATION=true
project="glosano-release-test-$(date +%s)-$$"
test_dir=$(mktemp -d)
compose=(docker compose -p "$project" -f deploy/compose.yaml)
cleanup() {
  result=$?
  if (( result != 0 )); then "${compose[@]}" logs --tail=80; fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null
  rm -rf "$test_dir"
  exit "$result"
}
trap cleanup EXIT
sql() { "${compose[@]}" exec -T postgres psql -U glosano -d glosano -Atc "$1"; }
ready_code() {
  "${compose[@]}" exec -T app-api python -c "import httpx; print(httpx.get('http://localhost:8000/health/ready').status_code)"
}
"${compose[@]}" config --quiet
"${compose[@]}" up -d --wait postgres redis
# Two initializers race on an empty database. Both must finish successfully.
"${compose[@]}" run --rm -T migrate > "$test_dir/migrate-1.log" 2>&1 &
first=$!
"${compose[@]}" run --rm -T migrate > "$test_dir/migrate-2.log" 2>&1 &
second=$!
wait "$first" || { cat "$test_dir/migrate-1.log"; exit 1; }
wait "$second" || { cat "$test_dir/migrate-2.log"; exit 1; }
"${compose[@]}" up -d --wait --wait-timeout 180
"${compose[@]}" exec -T app-api python - < deploy/tests/smoke.py
[[ $(ready_code) == 200 ]]
revision=$(sql 'SELECT version_num FROM alembic_version')
"${compose[@]}" stop app-worker
sql "UPDATE alembic_version SET version_num='not_a_revision'" >/dev/null
[[ $(ready_code) == 503 ]]
if "${compose[@]}" run --rm -T migrate > "$test_dir/failed-migration.log" 2>&1; then
  echo 'Migration with an unknown schema incorrectly succeeded' >&2
  exit 1
fi
sql "UPDATE alembic_version SET version_num='$revision'" >/dev/null
[[ $(ready_code) == 200 ]]
"${compose[@]}" stop redis
[[ $(ready_code) == 503 ]]
"${compose[@]}" start redis
"${compose[@]}" up -d --wait --wait-timeout 180
count=$(sql 'SELECT count(*) FROM lessons')
"${compose[@]}" stop app-api app-worker
"${compose[@]}" exec -T postgres pg_dump -U glosano -Fc glosano > "$test_dir/backup.dump"
# Exercise an upgrade from the preceding schema with existing user data.
"${compose[@]}" run --rm -T migrate alembic downgrade -1
"${compose[@]}" run --rm -T migrate
[[ $(sql 'SELECT count(*) FROM lessons') == "$count" ]]
sql 'TRUNCATE users CASCADE' >/dev/null
"${compose[@]}" exec -T postgres pg_restore -U glosano -d glosano --clean --if-exists --exit-on-error --single-transaction < "$test_dir/backup.dump"
[[ $(sql 'SELECT count(*) FROM lessons') == "$count" ]]
"${compose[@]}" up -d --force-recreate --wait --wait-timeout 180
[[ $(sql 'SELECT count(*) FROM lessons') == "$count" ]]
"${compose[@]}" exec -T app-api python - < deploy/tests/smoke.py
printf '%s\n' 'PASS: concurrent migrations, readiness, failure handling, persistence and backup restore'
