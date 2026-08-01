import { count } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "./index.js";
import { users } from "./schema.js";

/**
 * Ensures every ADMIN_EMAILS entry exists as an active admin. Google login is
 * the only auth method, so "seeding" means pre-authorizing these emails; the
 * Google account is linked on first sign-in. Runs on every boot so a locked
 * out admin can always be rescued via env.
 */
export async function seedAdmins(): Promise<void> {
  const [row] = await db.select({ n: count() }).from(users);
  if ((row?.n ?? 0) === 0 && config.adminEmails.length === 0) {
    throw new Error("Fresh database and ADMIN_EMAILS is empty — set ADMIN_EMAILS so someone can log in.");
  }
  for (const email of config.adminEmails) {
    await db
      .insert(users)
      .values({ email, role: "admin" })
      .onConflictDoUpdate({
        target: users.email,
        set: { role: "admin", status: "active" },
      });
  }
}
