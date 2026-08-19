import { build } from "esbuild";

await build({
  entryPoints: ["src/server/index.ts", "src/server/funds/ingest-cli.ts"],
  outdir: "dist/server",
  outbase: "src/server",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
});
