#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export TEST_IMAGE="${1:?Usage: smoke.sh IMAGE}"
project="glosano-smoke-$(date +%s)-$$"
compose=(docker compose -p "$project" -f deploy/tests/compose.yaml)
cleanup() {
  result=$?
  if (( result != 0 )); then "${compose[@]}" logs --tail=100; fi
  # Only resources of this unique, disposable smoke-test project are removed.
  "${compose[@]}" down --volumes --remove-orphans >/dev/null
  exit "$result"
}
trap cleanup EXIT
"${compose[@]}" run --rm app-api alembic upgrade head
"${compose[@]}" up -d app-api app-worker
"${compose[@]}" exec -T app-api python - < deploy/tests/smoke.py
