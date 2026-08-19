import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resumeOrphanedJobs } from "./funds/jobs.js";
import { describeIndexRefresh, refreshAllFundIndexes } from "./funds/universe.js";
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
  // a previous one and will never finish. Close those out and pick the work up
  // again — an uncapped run is hours long and should survive a deploy.
  const { closed, resumed } = await resumeOrphanedJobs();
  if (closed > 0) {
    console.warn(
      resumed
        ? `Closed ${closed} interrupted sync job(s); resumed as job ${resumed.id}.`
        : `Closed ${closed} interrupted sync job(s).`,
    );
  }
  console.log("Database ready (migrations applied, admins seeded).");

  // Not awaited: the fund index is what the dashboard counts against, but a
  // slow or unreachable source must not hold the server off its port. Each
  // provider is skipped if its stored list is still inside the freshness
  // window, so a restart loop costs nothing upstream.
  void refreshAllFundIndexes(db)
    .then((results) => console.log(`Fund index — ${describeIndexRefresh(results)}.`))
    .catch((error) => console.warn("Fund index refresh failed:", error));
}
