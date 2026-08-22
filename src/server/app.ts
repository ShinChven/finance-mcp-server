import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { config } from "./config.js";
import { errorHandler, type AppEnv } from "./lib/http.js";
import { csrfProtect } from "./middleware/csrf.js";
import { mcpRoutes } from "./mcp/index.js";
import { wellKnownRoutes } from "./oauth/metadata.js";
import { oauthRoutes } from "./oauth/routes.js";
import { activityRoutes } from "./routes/activity.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { clientRoutes } from "./routes/clients.js";
import { fundRoutes, syncRoutes } from "./routes/funds.js";
import { meRoutes } from "./routes/me.js";
import { noteCollectionRoutes, noteRoutes } from "./routes/notes.js";
import { skillRoutes } from "./routes/skills.js";
import { overviewRoutes } from "./routes/overview.js";
import { tokenRoutes } from "./routes/tokens.js";
import { toolRoutes } from "./routes/tools.js";
import { watchlistRoutes } from "./routes/watchlists.js";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://*.googleusercontent.com"],
        // `'self'` already covers same-origin ws: and wss: under CSP Level 3,
        // but naming the socket origin explicitly costs nothing and keeps the
        // dashboard working on browsers that never shipped that clarification.
        connectSrc: ["'self'", config.appOrigin.replace(/^http/, "ws")],
        frameAncestors: ["'none'"],
      },
      crossOriginEmbedderPolicy: false,
      // "no-referrer" (the middleware default) drops Referer even on same-origin
      // navigations, which breaks the CSRF Referer fallback for browsers that
      // send Origin: null after a cross-origin redirect chain. "same-origin"
      // keeps the same privacy guarantee (never leaks cross-origin) while
      // preserving same-origin Referer.
      referrerPolicy: "same-origin",
    }),
  );

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.route("/.well-known", wellKnownRoutes);
  app.route("/oauth", oauthRoutes);
  app.route("/auth", authRoutes);
  app.route("/mcp", mcpRoutes);

  const api = new Hono<AppEnv>().use(csrfProtect);
  api.route("/me", meRoutes);
  api.route("/activity", activityRoutes);
  api.route("/tokens", tokenRoutes);
  api.route("/clients", clientRoutes);
  api.route("/admin", adminRoutes);
  api.route("/overview", overviewRoutes);
  api.route("/tools", toolRoutes);
  api.route("/funds", fundRoutes);
  api.route("/sync", syncRoutes);
  api.route("/watchlists", watchlistRoutes);
  api.route("/notes", noteRoutes);
  api.route("/note-collections", noteCollectionRoutes);
  api.route("/skills", skillRoutes);
  app.route("/api", api);

  app.onError(errorHandler);

  return app;
}
