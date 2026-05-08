#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib.sh"

require_cmd curl
require_cmd jq

log "waiting for Daptin at $DAPTIN_BASE_URL"
wait_for_daptin

log "creating demo users before first-admin lock"
signup_ignore_existing "$DAPTIN_ADMIN_EMAIL" "$DAPTIN_ADMIN_PASSWORD" "Demo Admin"
signup_ignore_existing "$DEMO_ALICE_EMAIL" "$DEMO_ALICE_PASSWORD" "Alice OAuth Demo"
signup_ignore_existing "$DEMO_BOB_EMAIL" "$DEMO_BOB_PASSWORD" "Bob OAuth Demo"

ADMIN_TOKEN="$(signin "$DAPTIN_ADMIN_EMAIL" "$DAPTIN_ADMIN_PASSWORD")"
if [[ -z "$ADMIN_TOKEN" || "$ADMIN_TOKEN" == "null" ]]; then
  printf 'Could not sign in admin user %s\n' "$DAPTIN_ADMIN_EMAIL" >&2
  exit 1
fi

log "claiming administrator if this is a fresh database"
curl_action world become_an_administrator "$ADMIN_TOKEN" '{}' >/dev/null 2>/dev/null || true
sleep 3
ADMIN_TOKEN="$(signin "$DAPTIN_ADMIN_EMAIL" "$DAPTIN_ADMIN_PASSWORD")"
ALICE_TOKEN="$(signin "$DEMO_ALICE_EMAIL" "$DEMO_ALICE_PASSWORD")"
BOB_TOKEN="$(signin "$DEMO_BOB_EMAIL" "$DEMO_BOB_PASSWORD")"

if [[ -z "${GITHUB_OAUTH_CLIENT_ID:-}" || -z "${GITHUB_OAUTH_CLIENT_SECRET:-}" ]]; then
  log "GITHUB_OAUTH_CLIENT_ID/SECRET are empty; OAuth connector will be created with blank values for later patching"
fi

oauth_attrs="$(jq -nc \
  --arg name "github-e2e" \
  --arg client_id "${GITHUB_OAUTH_CLIENT_ID:-}" \
  --arg client_secret "${GITHUB_OAUTH_CLIENT_SECRET:-}" \
  --arg redirect_uri "$DAPTIN_OAUTH_REDIRECT_URI" \
  '{
    name:$name,
    client_id:$client_id,
    client_secret:$client_secret,
    scope:"read:user,user:email",
    response_type:"code",
    auth_url:"https://github.com/login/oauth/authorize",
    token_url:"https://github.com/login/oauth/access_token",
    profile_url:"https://api.github.com/user",
    redirect_uri:$redirect_uri,
    profile_email_path:"email",
    access_type_offline:true,
    allow_login:false
  }')"
GITHUB_OAUTH_CONNECT_ID="$(upsert_by_name oauth_connect github-e2e "$oauth_attrs" "$ADMIN_TOKEN")"
log "oauth_connect github-e2e: $GITHUB_OAUTH_CONNECT_ID"

github_oauth_spec="$(jq -c . "$ROOT_DIR/public/openapi/github-oauth-user.json")"
github_pat_spec="$(jq -c . "$ROOT_DIR/public/openapi/github-pat-user.json")"
stripe_spec="$(jq -c . "$ROOT_DIR/public/openapi/stripe-account.json")"

github_oauth_integration_attrs="$(jq -nc \
  --arg name "github_oauth_user" \
  --arg spec "$github_oauth_spec" \
  --arg oauth_connect_id "$GITHUB_OAUTH_CONNECT_ID" \
  '{
    name:$name,
    title:"GitHub OAuth /user",
    specification:$spec,
    specification_language:"openapiv3",
    specification_format:"json",
    authentication_type:"oauth2",
    authentication_specification:({oauth_connect_id:$oauth_connect_id} | tostring)
  }')"
GITHUB_OAUTH_INTEGRATION_ID="$(upsert_by_name integration github_oauth_user "$github_oauth_integration_attrs" "$ADMIN_TOKEN")"

github_pat_integration_attrs="$(jq -nc \
  --arg name "github_pat_user" \
  --arg spec "$github_pat_spec" \
  '{
    name:$name,
    title:"GitHub PAT /user",
    specification:$spec,
    specification_language:"openapiv3",
    specification_format:"json",
    authentication_type:"custom_credentials",
    authentication_specification:({scheme:"bearer",token_field:"token"} | tostring)
  }')"
GITHUB_PAT_INTEGRATION_ID="$(upsert_by_name integration github_pat_user "$github_pat_integration_attrs" "$ADMIN_TOKEN")"

stripe_integration_attrs="$(jq -nc \
  --arg name "stripe_account" \
  --arg spec "$stripe_spec" \
  '{
    name:$name,
    title:"Stripe Account",
    specification:$spec,
    specification_language:"openapiv3",
    specification_format:"json",
    authentication_type:"custom_credentials",
    authentication_specification:({scheme:"bearer",token_field:"secret_key"} | tostring)
  }')"
STRIPE_INTEGRATION_ID="$(upsert_by_name integration stripe_account "$stripe_integration_attrs" "$ADMIN_TOKEN")"

log "installing integration actions"
curl_action integration install_integration "$ADMIN_TOKEN" '{}' "$GITHUB_OAUTH_INTEGRATION_ID" >/dev/null
curl_action integration install_integration "$ADMIN_TOKEN" '{}' "$GITHUB_PAT_INTEGRATION_ID" >/dev/null
curl_action integration install_integration "$ADMIN_TOKEN" '{}' "$STRIPE_INTEGRATION_ID" >/dev/null

if [[ -n "${ALICE_GITHUB_PAT:-}" ]]; then
  attrs="$(jq -nc --arg name "alice-github-pat" --arg token "$ALICE_GITHUB_PAT" '{name:$name,content:({token:$token} | tostring)}')"
  upsert_by_name credential alice-github-pat "$attrs" "$ALICE_TOKEN" >/dev/null
fi
if [[ -n "${BOB_GITHUB_PAT:-}" ]]; then
  attrs="$(jq -nc --arg name "bob-github-pat" --arg token "$BOB_GITHUB_PAT" '{name:$name,content:({token:$token} | tostring)}')"
  upsert_by_name credential bob-github-pat "$attrs" "$BOB_TOKEN" >/dev/null
fi
if [[ -n "${STRIPE_SECRET_KEY:-}" ]]; then
  attrs="$(jq -nc --arg name "alice-stripe-secret" --arg secret_key "$STRIPE_SECRET_KEY" '{name:$name,content:({secret_key:$secret_key} | tostring)}')"
  upsert_by_name credential alice-stripe-secret "$attrs" "$ALICE_TOKEN" >/dev/null
fi

localstore_id="$(find_by_column cloud_store name localstore "$ADMIN_TOKEN")"
if [[ -z "$localstore_id" || "$localstore_id" == "null" ]]; then
  printf 'Could not find default cloud_store localstore\n' >&2
  exit 1
fi

site_attrs="$(jq -nc '{
  name:"integration-auth-demo",
  hostname:"integration-auth-demo",
  path:"integration-auth-demo",
  enable:true,
  site_type:"static"
}')"
site_rel="$(jq -nc --arg id "$localstore_id" '{cloud_store_id:{data:{type:"cloud_store",id:$id}}}')"
SITE_ID="$(upsert_by_name site integration-auth-demo "$site_attrs" "$ADMIN_TOKEN" "$site_rel")"

write_state

log "setup complete"
log "state written to $STATE_FILE"
log "run: make publish"
log "restart Daptin after setup (Docker: make restart; release mode: Ctrl-C and make run-daptin-release again)"
log "open: $DAPTIN_BASE_URL/integration-auth-demo/"
