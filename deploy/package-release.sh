#!/usr/bin/env bash
set -euo pipefail
version=${1:?Usage: package-release.sh vX.Y.Z OUTPUT_DIRECTORY}
output=${2:?Specify an empty output directory}
[[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Expected vX.Y.Z' >&2; exit 1; }
[[ ! -e $output ]] || { echo 'Output directory already exists' >&2; exit 1; }
cd "$(dirname "$0")/.."
mkdir -p "$output"
sed "s/__VERSION__/$version/g" deploy/install.sh > "$output/install.sh"
# Pin the release default for Portainer, while allowing explicit upgrades.
sed "s/\${GLOSANO_VERSION:?set a release version such as v0.0.1}/\${GLOSANO_VERSION:-$version}/g" deploy/compose.yaml > "$output/compose.yaml"
chmod +x "$output/install.sh"
(cd "$output" && sha256sum install.sh compose.yaml > SHA256SUMS)
