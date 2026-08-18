/**
 * In-process runner for fund sync jobs.
 *
 * A full sync is hours of throttled HTTP, so it cannot happen inside the
 * request that starts it. `startJob` writes the `ingest_jobs` row, kicks the
 * run off on the event loop and returns immediately; the dashboard then polls
 * the row for progress.
 *
 * Deliberately single-flight and in-memory: the container runs one server
 * process, and two concurrent runs would double the request rate against hosts
 * that already throttle aggressively. A process restart therefore orphans a
 * running job, which `reconcileOrphanedJobs` marks as failed at boot instead of
 * leaving it "running" forever.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { ingestJobs, type IngestJob } from "../db/schema.js";
import { yahooFinanceClient } from "../mcp/client.js";
import { runIngest, type IngestSummary } from "./ingest.js";
import type { IngestScope } from "./scope.js";

export interface StartJobOptions {
  scope: IngestScope;
  codes?: string[];
  limit?: number;
  force?: boolean;
  requestedBy?: string | null;
}

interface ActiveJob {
  id: string;
  controller: AbortController;
}

let active: ActiveJob | null = null;

export class JobInProgressError extends Error {
  constructor(public readonly jobId: string) {
    super("a sync is already running");
  }
}

export function activeJobId(): string | null {
  return active?.id ?? null;
}

/** Progress writes are throttled — a 3,000-fund run would otherwise issue one
 *  UPDATE per fund purely so a poller can see a number tick. */
const PROGRESS_INTERVAL_MS = 2_000;

export async function startJob(options: StartJobOptions): Promise<IngestJob> {
  if (active) throw new JobInProgressError(active.id);

  const [job] = await db
    .insert(ingestJobs)
    .values({
      scope: options.scope,
      status: "running",
      requestedBy: options.requestedBy ?? null,
      codes: options.codes ?? null,
      fundLimit: options.limit ?? null,
      startedAt: new Date(),
    })
    .returning();
  if (!job) throw new Error("failed to create ingest job");

  const controller = new AbortController();
  active = { id: job.id, controller };

  // Detached on purpose: the caller is an HTTP request that must not wait.
  void execute(job.id, options, controller).finally(() => {
    if (active?.id === job.id) active = null;
  });

  return job;
}

async function execute(
  jobId: string,
  options: StartJobOptions,
  controller: AbortController,
): Promise<void> {
  let lastWrite = 0;
  try {
    const summary: IngestSummary = await runIngest({
      db,
      yahoo: yahooFinanceClient,
      scope: options.scope,
      ...(options.codes ? { codes: options.codes } : {}),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      force: options.force ?? false,
      signal: controller.signal,
      // Universe refresh is one cheap request and keeps newly listed funds
      // reachable, so a dashboard-triggered sync always does it.
      skipUniverse: false,
      onProgress: async ({ processed, total }) => {
        const now = Date.now();
        if (now - lastWrite < PROGRESS_INTERVAL_MS && processed < total) return;
        lastWrite = now;
        await db
          .update(ingestJobs)
          .set({ processedFunds: processed, totalFunds: total })
          .where(eq(ingestJobs.id, jobId));
      },
    });

    await db
      .update(ingestJobs)
      .set({
        status: controller.signal.aborted ? "cancelled" : "succeeded",
        summary: summary as unknown as Record<string, unknown>,
        skippedFresh: summary.skippedFresh,
        finishedAt: new Date(),
      })
      .where(eq(ingestJobs.id, jobId));
  } catch (error) {
    await db
      .update(ingestJobs)
      .set({
        status: "failed",
        error: (error as Error).message.slice(0, 1000),
        finishedAt: new Date(),
      })
      .where(eq(ingestJobs.id, jobId));
  }
}

/** Signals the running job to stop after the fund it is on. */
export function cancelJob(jobId: string): boolean {
  if (active?.id !== jobId) return false;
  active.controller.abort();
  return true;
}

export async function latestJob(): Promise<IngestJob | undefined> {
  const [row] = await db
    .select()
    .from(ingestJobs)
    .orderBy(desc(ingestJobs.createdAt))
    .limit(1);
  return row;
}

/**
 * Fails jobs left "running" by a process that died mid-sync.
 *
 * Without this the dashboard would show a permanently stuck run and
 * `startJob` would be blocked by a job with no runner behind it.
 */
export async function reconcileOrphanedJobs(): Promise<number> {
  const rows = await db
    .update(ingestJobs)
    .set({
      status: "failed",
      error: "interrupted by a server restart",
      finishedAt: new Date(),
    })
    .where(and(inArray(ingestJobs.status, ["queued", "running"])))
    .returning({ id: ingestJobs.id });
  return rows.length;
}
