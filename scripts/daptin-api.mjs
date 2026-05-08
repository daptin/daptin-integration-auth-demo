import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnv() {
  const envPath = path.join(rootDir, ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const values = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    values[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return values;
}

const fileEnv = loadEnv();

export function env(name, fallback = "") {
  return process.env[name] || fileEnv[name] || fallback;
}

export const config = {
  baseUrl: env("DAPTIN_BASE_URL", "http://localhost:7336").replace(/\/+$/, ""),
  hostPort: env("DAPTIN_HOST_PORT", "7336"),
  adminEmail: env("DAPTIN_ADMIN_EMAIL", "admin@example.com"),
  adminPassword: env("DAPTIN_ADMIN_PASSWORD", "adminadmin"),
  aliceEmail: env("DEMO_ALICE_EMAIL", "alice@example.com"),
  alicePassword: env("DEMO_ALICE_PASSWORD", "alice-password"),
  bobEmail: env("DEMO_BOB_EMAIL", "bob@example.com"),
  bobPassword: env("DEMO_BOB_PASSWORD", "bob-password"),
  githubClientId: env("GITHUB_OAUTH_CLIENT_ID", ""),
  githubClientSecret: env("GITHUB_OAUTH_CLIENT_SECRET", ""),
  daptinOauthRedirectUri: env("DAPTIN_OAUTH_REDIRECT_URI", "http://localhost:7336/oauth/response"),
  aliceGithubPat: env("ALICE_GITHUB_PAT", ""),
  bobGithubPat: env("BOB_GITHUB_PAT", ""),
  stripeSecretKey: env("STRIPE_SECRET_KEY", ""),
  daptinDataDir: env("DAPTIN_DATA_DIR", path.join(rootDir, "daptin-data"))
};

export function log(message) {
  console.log(`[demo] ${message}`);
}

export async function request(method, urlPath, { token = "", body, jsonApi = false } = {}) {
  const headers = {};
  if (jsonApi) headers["Content-Type"] = "application/vnd.api+json";
  else headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(config.baseUrl + urlPath, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const error = new Error(`${method} ${urlPath} failed with HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function action(entity, name, attributes = {}, token = "", instanceId = "") {
  const attrs = instanceId ? { ...attributes, [`${entity}_id`]: instanceId } : attributes;
  return request("POST", `/action/${entity}/${name}`, {
    token,
    body: { attributes: attrs }
  });
}

export async function jsonApi(method, tablePath, body, token = "") {
  return request(method, tablePath, { token, body, jsonApi: true });
}

export function items(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data) return [payload.data];
  if (Array.isArray(payload)) return payload;
  return [];
}

export function attr(item, name) {
  if (!item) return undefined;
  if (item.attributes && Object.prototype.hasOwnProperty.call(item.attributes, name)) return item.attributes[name];
  return item[name];
}

export function tokenFromSignIn(payload) {
  const responses = Array.isArray(payload) ? payload : items(payload);
  for (const response of responses) {
    const attrs = response.Attributes || response.attributes || {};
    if (response.ResponseType === "client.store.set" && attrs.key === "token") return attrs.value;
    if (attrs.key === "token" && attrs.value) return attrs.value;
  }
  throw new Error("Sign-in response did not contain a token");
}

export async function signIn(email, password) {
  return tokenFromSignIn(await action("user_account", "signin", { email, password }));
}

export async function signUpIgnoreExisting(email, password, name) {
  try {
    await action("user_account", "signup", {
      email,
      name,
      password,
      passwordConfirm: password
    });
  } catch {
    // Existing user or public signup lock. Setup signs in next and fails there if the user is truly missing.
  }
}

export async function waitForDaptin(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await request("GET", "/api/world?page%5Bsize%5D=1", { jsonApi: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error(`Daptin did not become ready at ${config.baseUrl}`);
}

export async function findByColumn(table, column, value, token = "") {
  const query = encodeURIComponent(JSON.stringify([{ column, operator: "is", value }]));
  const payload = await jsonApi("GET", `/api/${table}?query=${query}&page%5Bsize%5D=100`, undefined, token);
  return items(payload).find((item) => String(attr(item, column)) === String(value)) || null;
}

export async function upsertByName(table, name, attributes, token, relationships) {
  const existing = await findByColumn(table, "name", name, token);
  if (existing) {
    const data = { type: table, id: existing.id, attributes };
    if (relationships) data.relationships = relationships;
    const payload = await jsonApi("PATCH", `/api/${table}/${existing.id}`, { data }, token);
    return items(payload)[0] || payload.data;
  }
  const data = { type: table, attributes };
  if (relationships) data.relationships = relationships;
  const payload = await jsonApi("POST", `/api/${table}`, { data }, token);
  return items(payload)[0] || payload.data;
}

export async function list(table, token = "", size = 100) {
  const payload = await jsonApi("GET", `/api/${table}?page%5Bsize%5D=${size}`, undefined, token);
  return items(payload);
}

export function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));
}

export function writeState(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${shellQuote(value || "")}`);
  fs.writeFileSync(path.join(rootDir, ".demo-state.env"), `${lines.join("\n")}\n`, { mode: 0o600 });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function loadState() {
  const statePath = path.join(rootDir, ".demo-state.env");
  if (!fs.existsSync(statePath)) return {};
  const state = {};
  for (const line of fs.readFileSync(statePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    let value = line.slice(idx + 1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/'\\''/g, "'");
    state[line.slice(0, idx)] = value;
  }
  return state;
}
