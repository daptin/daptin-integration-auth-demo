type Role = "admin" | "alice" | "bob";

type SessionConfig = {
  role: Role;
  label: string;
  email: string;
  password: string;
};

type JsonItem = {
  id: string;
  type?: string;
  attributes?: Record<string, unknown>;
};

const sessions: SessionConfig[] = [
  { role: "admin", label: "Admin", email: "admin@example.com", password: "adminadmin" },
  { role: "alice", label: "Alice", email: "alice@example.com", password: "alice-password" },
  { role: "bob", label: "Bob", email: "bob@example.com", password: "bob-password" }
];

const storage = {
  baseUrl: "daptin-demo.baseUrl",
  token: (role: Role) => `daptin-demo.${role}.token`
};

const matrix = [
  ["Alice executes githubOauthUser with Alice oauth_token_id", "200 response with Alice's GitHub login"],
  ["Bob executes githubOauthUser with Bob oauth_token_id", "200 response with Bob's GitHub login"],
  ["Alice executes githubOauthUser with Bob oauth_token_id", "Denied by Daptin before outbound GitHub call"],
  ["Alice executes githubPatUser with Alice credential_id", "200 response with PAT owner's GitHub login"],
  ["Bob executes githubPatUser with Alice credential_id", "Denied unless Bob has read permission to that credential"],
  ["Any execution with malicious Authorization action input", "Daptin still uses selected oauth_token_id or credential_id"]
];

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function getBaseUrl(): string {
  return (el<HTMLInputElement>("base-url").value || location.origin).replace(/\/+$/, "");
}

function setText(id: string, value: unknown): void {
  el<HTMLElement>(id).textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function token(role?: Role): string {
  const selected = role || (el<HTMLSelectElement>("execution-user").value as Role);
  return localStorage.getItem(storage.token(selected)) || "";
}

function authHeaders(role?: Role, jsonApi = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (jsonApi) headers["Content-Type"] = "application/vnd.api+json";
  else headers["Content-Type"] = "application/json";
  const value = token(role);
  if (value) headers.Authorization = `Bearer ${value}`;
  return headers;
}

async function request(method: string, path: string, body?: unknown, role?: Role, jsonApi = false): Promise<unknown> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: authHeaders(role, jsonApi),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const error = new Error(`${method} ${path} returned HTTP ${response.status}`);
    (error as Error & { payload?: unknown }).payload = payload;
    throw error;
  }
  return payload;
}

function items(payload: unknown): JsonItem[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (Array.isArray(data)) return data as JsonItem[];
  if (data) return [data as JsonItem];
  if (Array.isArray(payload)) return payload as JsonItem[];
  return [];
}

function attr(item: JsonItem | undefined, key: string): unknown {
  if (!item) return undefined;
  if (item.attributes && Object.prototype.hasOwnProperty.call(item.attributes, key)) return item.attributes[key];
  return (item as unknown as Record<string, unknown>)[key];
}

async function action(entity: string, name: string, attributes: Record<string, unknown>, role?: Role, instance?: string): Promise<unknown> {
  const attrs = instance ? { ...attributes, [`${entity}_id`]: instance } : attributes;
  return request("POST", `/action/${entity}/${name}`, { attributes: attrs }, role, false);
}

async function signIn(config: SessionConfig): Promise<void> {
  const payload = await action("user_account", "signin", { email: config.email, password: config.password });
  const responses = Array.isArray(payload) ? payload as Array<Record<string, unknown>> : items(payload) as unknown as Array<Record<string, unknown>>;
  for (const response of responses) {
    const attrs = (response.Attributes || response.attributes || {}) as Record<string, unknown>;
    if (response.ResponseType === "client.store.set" && attrs.key === "token" && typeof attrs.value === "string") {
      localStorage.setItem(storage.token(config.role), attrs.value);
      renderSessions();
      return;
    }
  }
  throw new Error("Sign-in response did not include a token");
}

async function list(table: string, role?: Role, size = 100): Promise<JsonItem[]> {
  const payload = await request("GET", `/api/${table}?page%5Bsize%5D=${size}`, undefined, role, true);
  return items(payload);
}

async function createCredential(): Promise<void> {
  const role = el<HTMLSelectElement>("execution-user").value as Role;
  const name = el<HTMLInputElement>("credential-name").value.trim();
  const field = el<HTMLSelectElement>("credential-field").value;
  const secret = el<HTMLInputElement>("credential-secret").value;
  if (!name || !secret) throw new Error("Credential name and secret are required");
  await request("POST", "/api/credential", {
    data: {
      type: "credential",
      attributes: {
        name,
        content: JSON.stringify({ [field]: secret })
      }
    }
  }, role, true);
  el<HTMLInputElement>("credential-secret").value = "";
  await refreshCredentials();
}

function extractRedirect(payload: unknown): string {
  const responses = Array.isArray(payload) ? payload as Array<Record<string, unknown>> : items(payload) as unknown as Array<Record<string, unknown>>;
  for (const response of responses) {
    const attrs = (response.Attributes || response.attributes || {}) as Record<string, unknown>;
    if (response.ResponseType === "client.redirect" && typeof attrs.location === "string") return attrs.location;
    if (typeof attrs.location === "string") return attrs.location;
  }
  throw new Error("OAuth begin response did not include a redirect URL");
}

async function startOAuth(): Promise<void> {
  const role = el<HTMLSelectElement>("execution-user").value as Role;
  const connectId = el<HTMLSelectElement>("oauth-connect").value;
  if (!connectId) throw new Error("Select the github-e2e oauth_connect row first");
  const payload = await action("oauth_connect", "oauth_login_begin", {}, role, connectId);
  const redirect = extractRedirect(payload);
  window.open(redirect, "_blank", "noopener,noreferrer");
  setText("result", { oauth_authorize_url: redirect });
}

function selectedOauthTokenId(): string {
  return el<HTMLInputElement>("manual-oauth-token").value.trim() || el<HTMLSelectElement>("oauth-token").value;
}

function selectedCredentialId(): string {
  return el<HTMLSelectElement>("credential-id").value;
}

function authOverrideAttrs(): Record<string, unknown> {
  return el<HTMLInputElement>("inject-auth").checked ? { Authorization: "Bearer this-must-not-win" } : {};
}

async function executeIntegration(operation: string, attrs: Record<string, unknown>): Promise<void> {
  const role = el<HTMLSelectElement>("execution-user").value as Role;
  const payload = await action("integration", operation, { ...attrs, ...authOverrideAttrs() }, role);
  setText("result", payload);
}

async function refreshSetup(): Promise<void> {
  const role = "admin";
  const [oauthConnects, integrations, actions] = await Promise.all([
    list("oauth_connect", role),
    list("integration", role),
    list("action", role, 300)
  ]);

  const connectSelect = el<HTMLSelectElement>("oauth-connect");
  connectSelect.innerHTML = "";
  for (const item of oauthConnects.filter((row) => attr(row, "name") === "github-e2e")) {
    connectSelect.append(new Option(`${attr(item, "name")} (${item.id})`, item.id));
  }

  setText("integrations", integrations
    .filter((row) => ["github_oauth_user", "github_pat_user", "stripe_account"].includes(String(attr(row, "name"))))
    .map((row) => ({ id: row.id, name: attr(row, "name"), auth: attr(row, "authentication_type") })));
  setText("actions", actions
    .filter((row) => ["githubOauthUser", "githubPatUser", "stripeAccount"].includes(String(attr(row, "action_name"))))
    .map((row) => ({ id: row.id, name: attr(row, "action_name"), instance_optional: attr(row, "instance_optional") })));
}

async function refreshOauthTokens(): Promise<void> {
  const role = el<HTMLSelectElement>("execution-user").value as Role;
  const rows = await list("oauth_token", role);
  const select = el<HTMLSelectElement>("oauth-token");
  select.innerHTML = "";
  for (const item of rows) {
    select.append(new Option(`${attr(item, "oauth_connect_name") || "oauth_token"} (${item.id})`, item.id));
  }
  setText("oauth-tokens", rows.map((row) => ({
    id: row.id,
    provider: attr(row, "oauth_connect_name"),
    user_account_id: attr(row, "user_account_id"),
    created_at: attr(row, "created_at")
  })));
}

async function refreshCredentials(): Promise<void> {
  const role = el<HTMLSelectElement>("execution-user").value as Role;
  const rows = await list("credential", role);
  const select = el<HTMLSelectElement>("credential-id");
  select.innerHTML = "";
  for (const item of rows) {
    select.append(new Option(`${attr(item, "name")} (${item.id})`, item.id));
  }
  setText("credentials", rows.map((row) => ({ id: row.id, name: attr(row, "name") })));
}

async function refreshAll(): Promise<void> {
  await refreshSetup();
  await refreshOauthTokens();
  await refreshCredentials();
}

function renderSessions(): void {
  const root = el<HTMLDivElement>("sessions");
  root.innerHTML = "";
  for (const config of sessions) {
    const card = document.createElement("div");
    card.className = "session";
    const hasToken = Boolean(localStorage.getItem(storage.token(config.role)));
    card.innerHTML = `
      <strong>${config.label}</strong>
      <label>Email <input data-email="${config.role}" value="${config.email}"></label>
      <label>Password <input data-password="${config.role}" type="password" value="${config.password}"></label>
      <button data-login="${config.role}" type="button">Sign in</button>
      <div class="status ${hasToken ? "ok" : ""}" data-status="${config.role}">
        ${hasToken ? "JWT stored in this browser" : "Not signed in"}
      </div>
    `;
    root.append(card);
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-login]")) {
    button.addEventListener("click", async () => {
      const role = button.dataset.login as Role;
      const config = sessions.find((item) => item.role === role);
      if (!config) return;
      config.email = root.querySelector<HTMLInputElement>(`[data-email="${role}"]`)?.value || config.email;
      config.password = root.querySelector<HTMLInputElement>(`[data-password="${role}"]`)?.value || config.password;
      await run(async () => signIn(config), `Signed in ${config.label}`);
    });
  }
}

function renderExecutionUsers(): void {
  const select = el<HTMLSelectElement>("execution-user");
  select.innerHTML = "";
  for (const item of sessions.filter((session) => session.role !== "admin")) {
    select.append(new Option(item.label, item.role));
  }
}

function renderMatrix(): void {
  const tbody = el<HTMLTableSectionElement>("matrix");
  tbody.innerHTML = "";
  for (const [testCase, expected] of matrix) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${testCase}</td><td>${expected}</td><td><input placeholder="manual result"></td>`;
    tbody.append(row);
  }
}

async function run(fn: () => Promise<void>, okMessage: string): Promise<void> {
  setText("result", "Working...");
  try {
    await fn();
    if (el<HTMLElement>("result").textContent === "Working...") setText("result", okMessage);
  } catch (error) {
    const err = error as Error & { payload?: unknown };
    setText("result", {
      error: err.message,
      payload: err.payload
    });
  }
}

function wire(): void {
  const base = el<HTMLInputElement>("base-url");
  base.value = localStorage.getItem(storage.baseUrl) || location.origin;
  base.addEventListener("change", () => localStorage.setItem(storage.baseUrl, getBaseUrl()));
  el<HTMLSelectElement>("execution-user").addEventListener("change", () => {
    void run(refreshOauthTokens, "OAuth tokens refreshed");
    void run(refreshCredentials, "Credentials refreshed");
  });
  el<HTMLButtonElement>("refresh-all").addEventListener("click", () => void run(refreshAll, "Refreshed"));
  el<HTMLButtonElement>("refresh-oauth-tokens").addEventListener("click", () => void run(refreshOauthTokens, "OAuth tokens refreshed"));
  el<HTMLButtonElement>("refresh-credentials").addEventListener("click", () => void run(refreshCredentials, "Credentials refreshed"));
  el<HTMLButtonElement>("start-oauth").addEventListener("click", () => void run(startOAuth, "OAuth started"));
  el<HTMLButtonElement>("create-credential").addEventListener("click", () => void run(createCredential, "Credential created"));
  el<HTMLButtonElement>("run-github-oauth").addEventListener("click", () => {
    void run(async () => executeIntegration("githubOauthUser", { oauth_token_id: selectedOauthTokenId() }), "Executed githubOauthUser");
  });
  el<HTMLButtonElement>("run-github-pat").addEventListener("click", () => {
    void run(async () => executeIntegration("githubPatUser", { credential_id: selectedCredentialId() }), "Executed githubPatUser");
  });
  el<HTMLButtonElement>("run-stripe").addEventListener("click", () => {
    void run(async () => executeIntegration("stripeAccount", { credential_id: selectedCredentialId() }), "Executed stripeAccount");
  });
}

renderSessions();
renderExecutionUsers();
renderMatrix();
wire();
void run(refreshAll, "Ready");
