#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${DAPTIN_DATA_DIR:-$ROOT_DIR/daptin-data}/storage/integration-auth-demo"

if [[ ! -d "$ROOT_DIR/dist" ]]; then
  printf 'dist/ does not exist. Run npm run build first.\n' >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
rsync -a --delete "$ROOT_DIR/dist/" "$TARGET_DIR/"
printf '[demo] published static site to %s\n' "$TARGET_DIR"

