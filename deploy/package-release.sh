#!/usr/bin/env bash
set -euo pipefail
version=${1:?Usage: package-release.sh vX.Y.Z OUTPUT_DIRECTORY}
output=${2:?Specify an empty output directory}
[[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Expected vX.Y.Z' >&2; exit 1; }
[[ ! -e $output ]] || { echo 'Output directory already exists' >&2; exit 1; }
cd "$(dirname "$0")/.."
mkdir -p "$output"
sed "s/__VERSION__/$version/g" deploy/install.sh > "$output/install.sh"
sed "s/__VERSION__/$version/g" deploy/install.ps1 > "$output/install.ps1"
# Pin the release default for Portainer, while allowing explicit upgrades.
sed "s/\${GLOSANO_VERSION:?set a release version such as v0.0.1}/\${GLOSANO_VERSION:-$version}/g" deploy/compose.yaml > "$output/compose.yaml"
sed "s/__VERSION__/$version/g" deploy/update.sh > "$output/update.sh"
sed "s/__VERSION__/$version/g" deploy/update.ps1 > "$output/update.ps1"
cp deploy/update-check.py "$output/update-check.py"
chmod +x "$output/install.sh" "$output/update.sh"
if command -v sha256sum >/dev/null; then checksum=(sha256sum); else checksum=(shasum -a 256); fi
(cd "$output" && "${checksum[@]}" install.sh install.ps1 update.sh update.ps1 update-check.py compose.yaml > SHA256SUMS)
