#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

DAPTIN_BASE_URL="${DAPTIN_BASE_URL:-http://localhost:7336}"
DAPTIN_ADMIN_EMAIL="${DAPTIN_ADMIN_EMAIL:-admin@example.com}"
DAPTIN_ADMIN_PASSWORD="${DAPTIN_ADMIN_PASSWORD:-adminadmin}"
DEMO_ALICE_EMAIL="${DEMO_ALICE_EMAIL:-alice@example.com}"
DEMO_ALICE_PASSWORD="${DEMO_ALICE_PASSWORD:-alice-password}"
DEMO_BOB_EMAIL="${DEMO_BOB_EMAIL:-bob@example.com}"
DEMO_BOB_PASSWORD="${DEMO_BOB_PASSWORD:-bob-password}"
GITHUB_OAUTH_CALLBACK_URL="${GITHUB_OAUTH_CALLBACK_URL:-http://localhost:7336/oauth/response?authenticator=github-e2e}"
DAPTIN_OAUTH_REDIRECT_URI="${DAPTIN_OAUTH_REDIRECT_URI:-http://localhost:7336/oauth/response}"

STATE_FILE="$ROOT_DIR/.demo-state.env"

log() {
  printf '[demo] %s\n' "$*" >&2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

json_api_headers() {
  local token="${1:-}"
  printf -- '-H\0Content-Type: application/vnd.api+json\0'
  if [[ -n "$token" ]]; then
    printf -- '-H\0Authorization: Bearer %s\0' "$token"
  fi
}

action_headers() {
  local token="${1:-}"
  printf -- '-H\0Content-Type: application/json\0'
  if [[ -n "$token" ]]; then
    printf -- '-H\0Authorization: Bearer %s\0' "$token"
  fi
}

curl_json() {
  local method="$1"
  local path="$2"
  local token="${3:-}"
  local body="${4:-}"
  shift 4 || true

  local -a header_args=()
  while IFS= read -r -d '' arg; do
    header_args+=("$arg")
  done < <(json_api_headers "$token")

  local -a curl_args=(-sS -o)
  local tmp
  tmp="$(mktemp)"
  curl_args+=("$tmp" -w "%{http_code}" -X "$method" "$DAPTIN_BASE_URL$path")
  curl_args+=("${header_args[@]}")
  if [[ -n "$body" ]]; then
    curl_args+=(-d "$body")
  fi
  local status
  status="$(curl "${curl_args[@]}")"
  cat "$tmp"
  rm -f "$tmp"
  if [[ "$status" -lt 200 || "$status" -gt 299 ]]; then
    printf '\nHTTP %s from %s %s\n' "$status" "$method" "$path" >&2
    return 1
  fi
}

curl_action() {
  local entity="$1"
  local action="$2"
  local token="${3:-}"
  local attrs="${4:-}"
  if [[ -z "$attrs" ]]; then
    attrs='{}'
  fi
  local instance="${5:-}"

  local -a header_args=()
  while IFS= read -r -d '' arg; do
    header_args+=("$arg")
  done < <(action_headers "$token")

  local path="/action/$entity"
  if [[ -n "$instance" ]]; then
    attrs="$(jq -nc --argjson attrs "$attrs" --arg key "${entity}_id" --arg value "$instance" '$attrs + {($key): $value}')"
  fi
  path="$path/$action"

  local tmp
  tmp="$(mktemp)"
  local status
  status="$(curl -sS -o "$tmp" -w "%{http_code}" -X POST "$DAPTIN_BASE_URL$path" "${header_args[@]}" -d "{\"attributes\":$attrs}")"
  cat "$tmp"
  rm -f "$tmp"
  if [[ "$status" -lt 200 || "$status" -gt 299 ]]; then
    printf '\nHTTP %s from POST %s\n' "$status" "$path" >&2
    return 1
  fi
}

token_from_signin_response() {
  jq -r '.[]? | select(.ResponseType == "client.store.set" and .Attributes.key == "token") | .Attributes.value' | head -1
}

signin() {
  local email="$1"
  local password="$2"
  curl_action user_account signin "" "$(jq -nc --arg email "$email" --arg password "$password" '{email:$email,password:$password}')" | token_from_signin_response
}

signup_ignore_existing() {
  local email="$1"
  local password="$2"
  local name="$3"
  curl_action user_account signup "" "$(jq -nc --arg email "$email" --arg password "$password" --arg name "$name" '{email:$email,name:$name,password:$password,passwordConfirm:$password}')" >/dev/null 2>/dev/null || true
}

wait_for_daptin() {
  local deadline=$((SECONDS + 90))
  until curl -fsS "$DAPTIN_BASE_URL/api/world?page%5Bsize%5D=1" >/dev/null 2>&1; do
    if (( SECONDS > deadline )); then
      printf 'Daptin did not become ready at %s\n' "$DAPTIN_BASE_URL" >&2
      exit 1
    fi
    sleep 2
  done
}

find_by_column() {
  local table="$1"
  local column="$2"
  local value="$3"
  local token="${4:-}"
  local query
  local raw_query
  raw_query="$(jq -nc --arg column "$column" --arg value "$value" '[{column:$column,operator:"is",value:$value}]')"
  query="$(jq -nr --arg q "$raw_query" '$q | @uri')"
  curl_json GET "/api/$table?query=$query&page%5Bsize%5D=100" "$token" "" \
    | jq -r --arg column "$column" --arg value "$value" '.data[]? | select((.attributes[$column] | tostring) == $value) | .id' \
    | head -1
}

create_row() {
  local table="$1"
  local attrs="$2"
  local token="$3"
  local relationships="${4:-null}"
  local payload
  payload="$(jq -nc --arg table "$table" --argjson attrs "$attrs" --argjson rel "$relationships" '
    {data:{type:$table,attributes:$attrs}} |
    if $rel == null then . else .data.relationships = $rel end
  ')"
  curl_json POST "/api/$table" "$token" "$payload" | jq -r '.data.id'
}

patch_row() {
  local table="$1"
  local id="$2"
  local attrs="$3"
  local token="$4"
  local relationships="${5:-null}"
  local payload
  payload="$(jq -nc --arg table "$table" --arg id "$id" --argjson attrs "$attrs" --argjson rel "$relationships" '
    {data:{type:$table,id:$id,attributes:$attrs}} |
    if $rel == null then . else .data.relationships = $rel end
  ')"
  curl_json PATCH "/api/$table/$id" "$token" "$payload" | jq -r '.data.id'
}

upsert_by_name() {
  local table="$1"
  local name="$2"
  local attrs="$3"
  local token="$4"
  local relationships="${5:-null}"
  local id
  id="$(find_by_column "$table" name "$name" "$token")"
  if [[ -n "$id" && "$id" != "null" ]]; then
    patch_row "$table" "$id" "$attrs" "$token" "$relationships" >/dev/null
    printf '%s\n' "$id"
  else
    create_row "$table" "$attrs" "$token" "$relationships"
  fi
}

write_state() {
  umask 077
  {
    printf 'DAPTIN_BASE_URL=%q\n' "$DAPTIN_BASE_URL"
    printf 'ADMIN_TOKEN=%q\n' "${ADMIN_TOKEN:-}"
    printf 'ALICE_TOKEN=%q\n' "${ALICE_TOKEN:-}"
    printf 'BOB_TOKEN=%q\n' "${BOB_TOKEN:-}"
    printf 'GITHUB_OAUTH_CONNECT_ID=%q\n' "${GITHUB_OAUTH_CONNECT_ID:-}"
    printf 'GITHUB_OAUTH_INTEGRATION_ID=%q\n' "${GITHUB_OAUTH_INTEGRATION_ID:-}"
    printf 'GITHUB_PAT_INTEGRATION_ID=%q\n' "${GITHUB_PAT_INTEGRATION_ID:-}"
    printf 'STRIPE_INTEGRATION_ID=%q\n' "${STRIPE_INTEGRATION_ID:-}"
    printf 'SITE_ID=%q\n' "${SITE_ID:-}"
  } > "$STATE_FILE"
}
