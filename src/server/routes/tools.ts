import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/http.js";
import { getMcpToolCatalog, toolMatches } from "../mcp/catalog.js";
import { requireAuth } from "../middleware/session.js";

// The catalog is small and never paginated; `q` mirrors the page's search param.
const toolsQuerySchema = z.object({ q: z.string().trim().max(200).optional() });

export const toolRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", zValidator("query", toolsQuerySchema), async (c) => {
    const { q } = c.req.valid("query");
    const catalog = await getMcpToolCatalog();
    const items = q ? catalog.tools.filter((tool) => toolMatches(tool, q)) : catalog.tools;

    return c.json({ server: catalog.server, items, total: items.length });
  });
