import fs from "node:fs/promises";
import path from "node:path";
import { config, rootDir } from "./daptin-api.mjs";

const source = path.join(rootDir, "dist");
const target = path.join(config.daptinDataDir, "storage", "integration-auth-demo");

try {
  await fs.access(source);
} catch {
  console.error("dist/ does not exist. Run npm run compile first.");
  process.exit(1);
}

await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
await fs.cp(source, target, { recursive: true });
console.log(`[demo] published static site to ${target}`);

