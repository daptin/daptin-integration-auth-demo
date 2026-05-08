#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib.sh"
if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi

require_cmd curl
require_cmd jq

token="${ADMIN_TOKEN:-}"
if [[ -z "$token" ]]; then
  token="$(signin "$DAPTIN_ADMIN_EMAIL" "$DAPTIN_ADMIN_PASSWORD")"
fi

printf '\nDaptin: %s\n' "$DAPTIN_BASE_URL"
printf 'Site:   %s/integration-auth-demo/\n\n' "$DAPTIN_BASE_URL"

printf 'OAuth connector:\n'
curl_json GET "/api/oauth_connect?page%5Bsize%5D=100" "$token" "" \
  | jq '.data[]? | select(.attributes.name == "github-e2e") | {id, name:.attributes.name, redirect_uri:.attributes.redirect_uri, scope:.attributes.scope}'

printf '\nIntegrations:\n'
curl_json GET "/api/integration?page%5Bsize%5D=100" "$token" "" \
  | jq '.data[]? | select(.attributes.name | IN("github_oauth_user","github_pat_user","stripe_account")) | {id, name:.attributes.name, auth:.attributes.authentication_type}'

printf '\nInstalled actions:\n'
curl_json GET "/api/action?page%5Bsize%5D=300" "$token" "" \
  | jq '.data[]? | select(.attributes.action_name | IN("githubOauthUser","githubPatUser","stripeAccount")) | {id, name:.attributes.action_name, instance_optional:.attributes.instance_optional, schema:.attributes.action_schema}'

printf '\nOAuth tokens visible to Alice:\n'
if [[ -n "${ALICE_TOKEN:-}" ]]; then
  curl_json GET "/api/oauth_token?page%5Bsize%5D=100" "$ALICE_TOKEN" "" \
    | jq '.data[]? | {id, provider:.attributes.oauth_connect_name, created_at:.attributes.created_at}'
else
  printf 'No ALICE_TOKEN in .demo-state.env\n'
fi

printf '\nCredentials visible to Alice:\n'
if [[ -n "${ALICE_TOKEN:-}" ]]; then
  curl_json GET "/api/credential?page%5Bsize%5D=100" "$ALICE_TOKEN" "" \
    | jq '.data[]? | {id, name:.attributes.name}'
else
  printf 'No ALICE_TOKEN in .demo-state.env\n'
fi
