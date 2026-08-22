import type { Server as NodeHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import type { attachRealtime as AttachRealtimeFn } from "./src/server/realtime/attach.js";
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

type AttachRealtime = typeof AttachRealtimeFn;

/**
 * The realtime socket, in dev.
 *
 * `@hono/vite-dev-server` is built around `fetch`, which has no concept of an
 * HTTP upgrade, so a WebSocket handshake routed through it simply hangs. The
 * socket instead attaches to the server Vite already owns for HMR, alongside
 * Vite's own upgrade listener -- each ignores the other's paths.
 *
 * `ssrLoadModule` rather than a static import, and that matters: it is how the
 * dev-server plugin loads `src/server/dev.ts`, so both land in the same SSR
 * module graph and therefore share one event bus. A static import here would
 * build a second copy of the server, whose publishes no socket could hear.
 */
function realtimeDevServer(): Plugin {
  const entry = fileURLToPath(new URL("./src/server/realtime/attach.ts", import.meta.url));
  return {
    name: "realtime-ws-dev",
    configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) return;
      httpServer.once("listening", () => {
        void server
          .ssrLoadModule(entry)
          .then((module) => {
            const attach = (module as { attachRealtime: AttachRealtime }).attachRealtime;
            // Vite types this as possibly HTTP/2, which it only is when the dev
            // server is configured for https. This one is not.
            // Vite's HMR socket is the other listener on this event, so
            // unmatched upgrades are left alone rather than refused.
            attach(httpServer as NodeHttpServer, { rejectUnmatched: false });
          })
          .catch((error: unknown) => {
            server.config.logger.error(`realtime socket failed to attach: ${String(error)}`);
          });
      });
    },
  };
}

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
    realtimeDevServer(),
  ],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    // Same port as the built server (src/server/index.ts), so APP_URL — and the
    // Google redirect URI derived from it — is identical in dev and production.
    port: Number(process.env.PORT) || 5173,
    // Fail instead of falling back to the next free port: the Google redirect
    // URI is registered against this exact port, so a shifted port silently
    // breaks OAuth.
    strictPort: true,
  },
});
