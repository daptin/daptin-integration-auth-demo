import {
  action,
  attr,
  config,
  findByColumn,
  log,
  readJson,
  signIn,
  signUpIgnoreExisting,
  upsertByName,
  waitForDaptin,
  writeState
} from "./daptin-api.mjs";

await waitForDaptin();

log("creating demo users before first-admin lock");
await signUpIgnoreExisting(config.adminEmail, config.adminPassword, "Demo Admin");
await signUpIgnoreExisting(config.aliceEmail, config.alicePassword, "Alice OAuth Demo");
await signUpIgnoreExisting(config.bobEmail, config.bobPassword, "Bob OAuth Demo");

let adminToken = await signIn(config.adminEmail, config.adminPassword);
try {
  log("claiming administrator if this is a fresh database");
  await action("world", "become_an_administrator", {}, adminToken);
} catch {
  // Already claimed.
}
await new Promise((resolve) => setTimeout(resolve, 3000));

adminToken = await signIn(config.adminEmail, config.adminPassword);
const aliceToken = await signIn(config.aliceEmail, config.alicePassword);
const bobToken = await signIn(config.bobEmail, config.bobPassword);

if (!config.githubClientId || !config.githubClientSecret) {
  log("GITHUB_OAUTH_CLIENT_ID/SECRET are empty; OAuth connector will be created with blank values for later patching");
}

const oauthConnect = await upsertByName("oauth_connect", "github-e2e", {
  name: "github-e2e",
  client_id: config.githubClientId,
  client_secret: config.githubClientSecret,
  scope: "read:user,user:email",
  response_type: "code",
  auth_url: "https://github.com/login/oauth/authorize",
  token_url: "https://github.com/login/oauth/access_token",
  profile_url: "https://api.github.com/user",
  redirect_uri: config.daptinOauthRedirectUri,
  profile_email_path: "email",
  access_type_offline: true,
  allow_login: false
}, adminToken);
log(`oauth_connect github-e2e: ${oauthConnect.id}`);

const githubOauthSpec = JSON.stringify(readJson("public/openapi/github-oauth-user.json"));
const githubPatSpec = JSON.stringify(readJson("public/openapi/github-pat-user.json"));
const stripeSpec = JSON.stringify(readJson("public/openapi/stripe-account.json"));

const githubOauthIntegration = await upsertByName("integration", "github_oauth_user", {
  name: "github_oauth_user",
  title: "GitHub OAuth /user",
  specification: githubOauthSpec,
  specification_language: "openapiv3",
  specification_format: "json",
  authentication_type: "oauth2",
  authentication_specification: JSON.stringify({ oauth_connect_id: oauthConnect.id })
}, adminToken);

const githubPatIntegration = await upsertByName("integration", "github_pat_user", {
  name: "github_pat_user",
  title: "GitHub PAT /user",
  specification: githubPatSpec,
  specification_language: "openapiv3",
  specification_format: "json",
  authentication_type: "custom_credentials",
  authentication_specification: JSON.stringify({ scheme: "bearer", token_field: "token" })
}, adminToken);

const stripeIntegration = await upsertByName("integration", "stripe_account", {
  name: "stripe_account",
  title: "Stripe Account",
  specification: stripeSpec,
  specification_language: "openapiv3",
  specification_format: "json",
  authentication_type: "custom_credentials",
  authentication_specification: JSON.stringify({ scheme: "bearer", token_field: "secret_key" })
}, adminToken);

log("installing integration actions");
await action("integration", "install_integration", {}, adminToken, githubOauthIntegration.id);
await action("integration", "install_integration", {}, adminToken, githubPatIntegration.id);
await action("integration", "install_integration", {}, adminToken, stripeIntegration.id);

if (config.aliceGithubPat) {
  await upsertByName("credential", "alice-github-pat", {
    name: "alice-github-pat",
    content: JSON.stringify({ token: config.aliceGithubPat })
  }, aliceToken);
}
if (config.bobGithubPat) {
  await upsertByName("credential", "bob-github-pat", {
    name: "bob-github-pat",
    content: JSON.stringify({ token: config.bobGithubPat })
  }, bobToken);
}
if (config.stripeSecretKey) {
  await upsertByName("credential", "alice-stripe-secret", {
    name: "alice-stripe-secret",
    content: JSON.stringify({ secret_key: config.stripeSecretKey })
  }, aliceToken);
}

const localStore = await findByColumn("cloud_store", "name", "localstore", adminToken);
if (!localStore) throw new Error("Could not find default cloud_store localstore");

const site = await upsertByName("site", "integration-auth-demo", {
  name: "integration-auth-demo",
  hostname: "integration-auth-demo",
  path: "integration-auth-demo",
  enable: true,
  site_type: "static"
}, adminToken, {
  cloud_store_id: { data: { type: "cloud_store", id: localStore.id } }
});

writeState({
  DAPTIN_BASE_URL: config.baseUrl,
  ADMIN_TOKEN: adminToken,
  ALICE_TOKEN: aliceToken,
  BOB_TOKEN: bobToken,
  GITHUB_OAUTH_CONNECT_ID: oauthConnect.id,
  GITHUB_OAUTH_INTEGRATION_ID: githubOauthIntegration.id,
  GITHUB_PAT_INTEGRATION_ID: githubPatIntegration.id,
  STRIPE_INTEGRATION_ID: stripeIntegration.id,
  SITE_ID: site.id
});

log("setup complete");
log("state written to .demo-state.env");
log("run: npm run publish");
log("restart Daptin after setup");
log(`open: ${config.baseUrl}/integration-auth-demo/`);

