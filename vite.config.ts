import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
// Same trick as src/server/load-env.ts, repeated here because the config is
// evaluated before any entry point runs — it makes PORT available below.
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on real environment variables.
}
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import devServer from "@hono/vite-dev-server";

// Paths handled by the Hono backend; everything else is served by Vite (SPA + assets).
const backendPaths = ["api", "auth", "oauth", "mcp", "healthz", "\\.well-known"];

export default defineConfig({
  root: "src/web",
  publicDir: false,
  plugins: [
    react(),
    tailwindcss(),
    devServer({
      entry: fileURLToPath(new URL("./src/server/dev.ts", import.meta.url)),
      exclude: [new RegExp(`^(?!/(${backendPaths.join("|")})(/|$)).*`)],
      injectClientScript: false,
    }),
  ],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    // Same port as the built server (src/server/index.ts), so APP_URL — and the
    // Google redirect URI derived from it — is identical in dev and production.
    port: Number(process.env.PORT) || 5173,
  },
});
