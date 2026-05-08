import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, env, rootDir } from "./daptin-api.mjs";

const releaseTag = env("DAPTIN_RELEASE_TAG", "latest");
const platform = process.platform;
const arch = process.arch;

let asset;
if (platform === "win32") {
  asset = "daptin-windows-amd64.exe";
} else if (platform === "linux") {
  asset = arch === "arm64" ? "daptin-linux-arm64" : "daptin-linux-amd64";
} else if (platform === "darwin") {
  asset = "daptin-darwin-amd64";
  if (arch === "arm64") console.log("[demo] Daptin publishes darwin-amd64 release binaries; using that asset on Apple Silicon");
} else {
  throw new Error(`Unsupported platform: ${platform}`);
}

const binDir = path.join(rootDir, "bin");
const binary = path.join(binDir, `${releaseTag}-${asset}`);
await fs.mkdir(binDir, { recursive: true });
await fs.mkdir(path.join(config.daptinDataDir, "storage"), { recursive: true });
await fs.mkdir(path.join(config.daptinDataDir, "cache"), { recursive: true });

try {
  await fs.access(binary);
} catch {
  await downloadReleaseAsset(releaseTag, asset, binary);
}

if (platform !== "win32") await fs.chmod(binary, 0o755);

console.log(`[demo] starting ${binary} on port ${config.hostPort}`);
const child = spawn(binary, ["-runtime", "release", "-port", `:${config.hostPort}`], {
  stdio: "inherit",
  env: {
    ...process.env,
    DAPTIN_DB_CONNECTION_STRING: path.join(config.daptinDataDir, "daptin.db"),
    DAPTIN_LOCAL_STORAGE_PATH: path.join(config.daptinDataDir, "storage"),
    DAPTIN_CACHE_FOLDER: path.join(config.daptinDataDir, "cache")
  }
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code || 0);
});

async function downloadReleaseAsset(tag, assetName, target) {
  const apiUrl = tag === "latest"
    ? "https://api.github.com/repos/daptin/daptin/releases/latest"
    : `https://api.github.com/repos/daptin/daptin/releases/tags/${encodeURIComponent(tag)}`;

  console.log(`[demo] resolving daptin/daptin ${tag} release asset ${assetName}`);
  const releaseResponse = await fetch(apiUrl, {
    headers: { "User-Agent": "daptin-integration-auth-demo" }
  });
  if (!releaseResponse.ok) throw new Error(`GitHub release lookup failed with HTTP ${releaseResponse.status}`);
  const release = await releaseResponse.json();
  const asset = release.assets.find((item) => item.name === assetName);
  if (!asset) throw new Error(`Release ${release.tag_name || tag} does not contain ${assetName}`);

  console.log(`[demo] downloading ${asset.browser_download_url}`);
  const response = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "daptin-integration-auth-demo" }
  });
  if (!response.ok) throw new Error(`Asset download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(target, bytes);
}

