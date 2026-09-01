import { auditLog } from "../db/schema.js";

/**
 * Resolved on first write rather than at import.
 *
 * `db/index.ts` opens a pool and reads `config` as a side effect of being
 * imported, so a module-level import here would drag the whole database and
 * environment into the import graph of anything that merely *might* audit —
 * which is now the MCP tool registry, exercised by tests that have no
 * environment and never touch a database. Deferring it keeps auditing free to
 * reach for from anywhere.
 */
async function database() {
  return (await import("../db/index.js")).db;
}

export async function audit(entry: {
  actorUserId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  try {
    const db = await database();
    await db.insert(auditLog).values({
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      meta: entry.meta,
      ip: entry.ip,
    });
  } catch (err) {
    // Audit writes must never take down the request path.
    console.error("audit write failed:", err);
  }
}
