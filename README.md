# Daptin Integration Auth Demo

This is a standalone manual E2E project for Daptin integrations that execute with a user-selected OAuth token or a user-selected custom credential.

Runtime serving is Daptin only. This demo does not ask users to build Daptin. Use either the published Docker image or a binary downloaded from the latest GitHub release. Node is used only to compile the static browser app into `dist/`, and the site is published into Daptin local storage as a subsite.

## What It Tests

- GitHub OAuth app connection stored in `oauth_connect`
- Per-user GitHub OAuth tokens stored in `oauth_token`
- OAuth integration execution with `oauth_token_id`
- GitHub PAT and Stripe custom credential integrations with `credential_id`
- Wrong-user denial paths for OAuth tokens and credentials
- Header override protection by sending a malicious `Authorization` action input

## Prerequisites

- Docker, or internet access to download the Daptin GitHub release binary
- Node 20+
- A GitHub OAuth app with callback URL:

```text
http://localhost:7336/oauth/response?authenticator=github-e2e
```

Use two real GitHub accounts for the multi-user OAuth checks.

## Setup

```bash
cp .env.example .env.local
```

Set:

```text
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
```

Keep `DAPTIN_OAUTH_REDIRECT_URI` as `http://localhost:7336/oauth/response`. Daptin appends `?authenticator=github-e2e` when it builds the provider authorize URL, so the GitHub OAuth app callback URL must include that query string.

Start Daptin from Docker in one terminal:

```bash
npm run docker:up
```

The default image is `daptin/daptin:v0.12.2`, because Docker does not currently publish a `latest` tag.

Or run the GitHub release binary directly. The default `DAPTIN_RELEASE_TAG=latest` downloads the latest release asset:

```bash
npm run daptin:release
```

This downloads the `daptin/daptin` release asset for your OS/architecture, then stores Daptin DB/files under this demo's `daptin-data/`.

On Apple Silicon, release-binary mode uses Daptin's published `darwin-amd64` asset. Use Docker if Rosetta is not available.

Bootstrap users, OAuth connector, integrations, actions, and the subsite row:

```bash
npm run setup
```

The scripts call instance actions as `/action/{type}/{action}` with `{type}_id` in `attributes`, which is the route shape Daptin registers for actions.

Compile and publish the static site into Daptin local storage:

```bash
npm install
npm run publish
```

Open:

```text
http://localhost:7336/integration-auth-demo/
```

Daptin registers subsite routes on startup, so restart Daptin after `npm run setup` creates the site row. In Docker mode use `npm run docker:restart`; in release-binary mode stop `npm run daptin:release` with `Ctrl-C` and run it again. File updates after that can be republished with `npm run publish`; restart if the subsite does not refresh within 10-15 seconds.

## Manual E2E Flow

1. Sign in Alice and Bob in the browser app.
2. Select Alice and click `Start GitHub OAuth`.
3. Complete GitHub OAuth as GitHub user A.
4. Return to the demo and refresh OAuth tokens.
5. Select Bob and repeat OAuth as GitHub user B.
6. Run `GitHub via OAuth Token` for Alice with Alice's token.
7. Run `GitHub via OAuth Token` for Bob with Bob's token.
8. Select Alice but paste Bob's `oauth_token_id`; execution must fail.
9. Create a GitHub PAT credential for Alice and run `GitHub via Credential`.
10. Select Bob and try Alice's credential; execution must fail unless permission was deliberately granted.
11. Enable `send malicious Authorization action input` and rerun the passing cases; provider identity must still come from the selected token or credential.

## Useful Commands

```bash
npm run verify
docker compose logs -f daptin
npm run docker:down
```

`make verify` prints registered connectors, integrations, installed actions, visible tokens, and visible credentials without printing secrets.

## Notes

- The app stores Daptin JWTs in browser `localStorage` for manual testing.
- OAuth callback may redirect to `/sign-in` after Daptin stores the token. Return to `/integration-auth-demo/` and refresh tokens.
- Optional PAT setup can be automated by setting `ALICE_GITHUB_PAT` or `BOB_GITHUB_PAT` in `.env.local`; otherwise create credentials from the browser app.
