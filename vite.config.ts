import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
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
    port: 5173,
  },
});
