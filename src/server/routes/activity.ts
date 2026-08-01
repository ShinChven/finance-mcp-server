import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import type { AppEnv } from "../lib/http.js";
import { escapeLike, listQuerySchema, listResponse, parseSort } from "../lib/listing.js";
import { requireAuth } from "../middleware/session.js";

export const activityRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", zValidator("query", listQuerySchema), async (c) => {
    const user = c.get("user");
    const query = c.req.valid("query");
    const filters: SQL[] = [eq(auditLog.actorUserId, user.id)];

    if (query.action) filters.push(eq(auditLog.action, query.action));
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      filters.push(
        or(
          ilike(auditLog.action, like),
          ilike(auditLog.targetType, like),
          ilike(auditLog.targetId, like),
        )!,
      );
    }

    const where = and(...filters);
    const order = parseSort(
      query.sort,
      { created_at: auditLog.createdAt, action: auditLog.action },
      desc(auditLog.createdAt),
    );
    const [totalRow] = await db.select({ n: count() }).from(auditLog).where(where);
    const rows = await db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(order)
      .limit(query.per_page)
      .offset((query.page - 1) * query.per_page);

    return c.json(
      listResponse(
        rows.map((entry) => ({
          id: entry.id,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          meta: entry.meta,
          ip: entry.ip,
          createdAt: entry.createdAt,
        })),
        totalRow?.n ?? 0,
        query,
      ),
    );
  });
