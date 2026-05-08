import { attr, config, list, loadState, signIn } from "./daptin-api.mjs";

const state = loadState();
const adminToken = state.ADMIN_TOKEN || await signIn(config.adminEmail, config.adminPassword);
const aliceToken = state.ALICE_TOKEN || "";

console.log(`\nDaptin: ${config.baseUrl}`);
console.log(`Site:   ${config.baseUrl}/integration-auth-demo/\n`);

console.log("OAuth connector:");
console.log(JSON.stringify((await list("oauth_connect", adminToken))
  .filter((row) => attr(row, "name") === "github-e2e")
  .map((row) => ({
    id: row.id,
    name: attr(row, "name"),
    redirect_uri: attr(row, "redirect_uri"),
    scope: attr(row, "scope")
  })), null, 2));

console.log("\nIntegrations:");
console.log(JSON.stringify((await list("integration", adminToken))
  .filter((row) => ["github_oauth_user", "github_pat_user", "stripe_account"].includes(String(attr(row, "name"))))
  .map((row) => ({
    id: row.id,
    name: attr(row, "name"),
    auth: attr(row, "authentication_type")
  })), null, 2));

console.log("\nInstalled actions:");
console.log(JSON.stringify((await list("action", adminToken, 300))
  .filter((row) => ["githubOauthUser", "githubPatUser", "stripeAccount"].includes(String(attr(row, "action_name"))))
  .map((row) => ({
    id: row.id,
    name: attr(row, "action_name"),
    instance_optional: attr(row, "instance_optional")
  })), null, 2));

if (aliceToken) {
  console.log("\nOAuth tokens visible to Alice:");
  console.log(JSON.stringify((await list("oauth_token", aliceToken)).map((row) => ({
    id: row.id,
    provider: attr(row, "oauth_connect_name"),
    created_at: attr(row, "created_at")
  })), null, 2));

  console.log("\nCredentials visible to Alice:");
  console.log(JSON.stringify((await list("credential", aliceToken)).map((row) => ({
    id: row.id,
    name: attr(row, "name")
  })), null, 2));
}

