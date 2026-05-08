#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

DAPTIN_RELEASE_TAG="${DAPTIN_RELEASE_TAG:-v0.12.2}"
DAPTIN_HOST_PORT="${DAPTIN_HOST_PORT:-7336}"

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) printf 'Unsupported OS for release binary: %s\n' "$(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch="amd64" ;;
  arm64|aarch64)
    if [[ "$os" == "darwin" ]]; then
      arch="amd64"
      printf '[demo] Daptin publishes darwin-amd64 release binaries; using that asset on Apple Silicon\n'
    else
      arch="arm64"
    fi
    ;;
  *) printf 'Unsupported architecture for release binary: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac

asset="daptin-${os}-${arch}"
binary="$ROOT_DIR/bin/${DAPTIN_RELEASE_TAG}-${asset}"

mkdir -p "$ROOT_DIR/bin" "$ROOT_DIR/daptin-data/storage" "$ROOT_DIR/daptin-data/cache"

if [[ ! -x "$binary" ]]; then
  command -v gh >/dev/null 2>&1 || {
    printf 'gh is required to download Daptin release binaries. Use Docker with make up instead.\n' >&2
    exit 1
  }

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  printf '[demo] downloading daptin/daptin %s asset %s\n' "$DAPTIN_RELEASE_TAG" "$asset"
  if [[ "$DAPTIN_RELEASE_TAG" == "latest" ]]; then
    gh release download --repo daptin/daptin --pattern "$asset" --dir "$tmp"
  else
    gh release download "$DAPTIN_RELEASE_TAG" --repo daptin/daptin --pattern "$asset" --dir "$tmp"
  fi
  mv "$tmp/$asset" "$binary"
  chmod +x "$binary"
fi

printf '[demo] starting %s on port %s\n' "$binary" "$DAPTIN_HOST_PORT"
DAPTIN_DB_CONNECTION_STRING="$ROOT_DIR/daptin-data/daptin.db" \
DAPTIN_LOCAL_STORAGE_PATH="$ROOT_DIR/daptin-data/storage" \
DAPTIN_CACHE_FOLDER="$ROOT_DIR/daptin-data/cache" \
  "$binary" -runtime release -port ":$DAPTIN_HOST_PORT"
