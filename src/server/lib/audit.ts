import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";

export async function audit(entry: {
  actorUserId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  try {
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
