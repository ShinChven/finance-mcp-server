import { migrate } from "drizzle-orm/node-postgres/migrator";
import { reconcileOrphanedJobs } from "./china/jobs.js";
import { scheduleCleanup } from "./db/cleanup.js";
import { db, waitForDb } from "./db/index.js";
import { seedAdmins } from "./db/seed.js";

declare global {
  var __mcpServerBootstrapped: boolean | undefined;
}

/** Waits for Postgres, applies pending migrations, seeds env-configured admins. */
export async function bootstrap(): Promise<void> {
  // The Vite dev server re-imports the server module on HMR; only boot once per process.
  if (globalThis.__mcpServerBootstrapped) return;
  globalThis.__mcpServerBootstrapped = true;

  await waitForDb();
  await migrate(db, { migrationsFolder: "drizzle" });
  await seedAdmins();
  scheduleCleanup();
  // Sync jobs live in this process, so anything still marked running belongs to
  // a previous one and will never finish.
  const orphaned = await reconcileOrphanedJobs();
  if (orphaned > 0) console.warn(`Marked ${orphaned} interrupted sync job(s) as failed.`);
  console.log("Database ready (migrations applied, admins seeded).");
}
