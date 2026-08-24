// Production entry: one Hono process serves the API, OAuth, MCP endpoint and
// the built SPA from dist/web.
import "./load-env.js";
import type { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { bootstrap } from "./bootstrap.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/index.js";
import { attachRealtime } from "./realtime/attach.js";
import { closeAllSockets } from "./realtime/socket.js";
import { BRAND_SLUG } from "../shared/brand.js";

await bootstrap();

const app = createApp();

// Static assets, then SPA fallback for client-side routes.
app.use("*", serveStatic({ root: "./dist/web" }));
app.get("*", serveStatic({ path: "./dist/web/index.html" }));

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`${BRAND_SLUG} listening on http://localhost:${info.port}`);
});

// The realtime endpoint attaches to the Node server rather than the Hono app:
// an upgrade never becomes a `Response`, and `socket.ts` needs the raw socket.
attachRealtime(server as unknown as HttpServer);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down…`);
    // Open sockets would otherwise hold `close` open until they time out.
    closeAllSockets();
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
