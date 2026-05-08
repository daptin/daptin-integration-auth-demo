import { mkdir, cp, copyFile } from "node:fs/promises";
import esbuild from "esbuild";

await mkdir("dist/assets", { recursive: true });
await mkdir("dist/openapi", { recursive: true });

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  sourcemap: true,
  format: "esm",
  target: "es2022",
  outfile: "dist/assets/main.js"
});

await copyFile("src/index.html", "dist/index.html");
await copyFile("src/style.css", "dist/assets/style.css");
await cp("public/openapi", "dist/openapi", { recursive: true });

