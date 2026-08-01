// Production entry: one Hono process serves the API, OAuth, MCP endpoint and
// the built SPA from dist/web.
import "./load-env.js";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { bootstrap } from "./bootstrap.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/index.js";

await bootstrap();

const app = createApp();

// Static assets, then SPA fallback for client-side routes.
app.use("*", serveStatic({ root: "./dist/web" }));
app.get("*", serveStatic({ path: "./dist/web/index.html" }));

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`mcp-server listening on http://localhost:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down…`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
