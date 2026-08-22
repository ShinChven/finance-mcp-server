/**
 * In-process runner for fund sync jobs.
 *
 * A full sync is hours of throttled HTTP, so it cannot happen inside the
 * request that starts it. `startJob` writes the `ingest_jobs` row, kicks the
 * run off on the event loop and returns immediately; the dashboard then polls
 * the row for progress.
 *
 * Deliberately single-flight across every provider, and in-memory: the
 * container runs one server process, and two concurrent runs would double the
 * request rate against hosts that already throttle aggressively. Two providers
 * do not share an upstream, so this is stricter than it strictly has to be —
 * but a sync is a background chore, and one queue is far easier to reason about
 * than a lock per provider. A process restart therefore orphans a
 * running job, which `resumeOrphanedJobs` closes at boot and then continues, so
 * an uncapped run survives a deploy without anyone having to press the button
 * again.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { ingestJobs, type IngestJob } from "../db/schema.js";
import { yahooFinanceClient } from "../mcp/client.js";
import type { ProviderId } from "../../shared/funds.js";
import { runIngest, type IngestSummary } from "./ingest.js";
import { publishAdminChange, publishJob } from "../realtime/bus.js";
import type { JobProgress } from "../../shared/realtime.js";
import { getProvider } from "./providers/index.js";

export interface StartJobOptions {
  provider: ProviderId;
  /** One of the provider's own scope ids. */
  scope: string;
  codes?: string[];
  /** `null` runs the whole scope uncapped; omitted uses the runner's default. */
  limit?: number | null;
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

/**
 * The subset of a job row the console actually renders while a run is in
 * flight. Pushed with its values rather than as a bare "something changed",
 * because that is the whole reason the panel used to poll every three seconds.
 */
function toProgress(row: IngestJob): JobProgress {
  return {
    id: row.id,
    status: row.status,
    processedFunds: row.processedFunds,
    totalFunds: row.totalFunds,
    skippedFresh: row.skippedFresh,
    error: row.error,
  };
}

/** Terminal states also change the cache itself, so the fund pages re-read. */
function announceFinished(row: IngestJob | undefined): void {
  if (!row) return;
  publishJob(toProgress(row), null);
  publishAdminChange("funds", "updated");
}

export async function startJob(options: StartJobOptions): Promise<IngestJob> {
  if (active) throw new JobInProgressError(active.id);

  const [job] = await db
    .insert(ingestJobs)
    .values({
      provider: options.provider,
      scope: options.scope,
      status: "running",
      requestedBy: options.requestedBy ?? null,
      codes: options.codes ?? null,
      fundLimit: options.limit ?? null,
      force: options.force ?? false,
      startedAt: new Date(),
    })
    .returning();
  if (!job) throw new Error("failed to create ingest job");

  const controller = new AbortController();
  active = { id: job.id, controller };
  publishJob(toProgress(job), job.id);

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
      provider: getProvider(options.provider),
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
        const [row] = await db
          .update(ingestJobs)
          .set({ processedFunds: processed, totalFunds: total })
          .where(eq(ingestJobs.id, jobId))
          .returning();
        if (row) publishJob(toProgress(row), jobId);
      },
    });

    const [finished] = await db
      .update(ingestJobs)
      .set({
        status: controller.signal.aborted ? "cancelled" : "succeeded",
        summary: summary as unknown as Record<string, unknown>,
        skippedFresh: summary.skippedFresh,
        finishedAt: new Date(),
      })
      .where(eq(ingestJobs.id, jobId))
      .returning();
    announceFinished(finished);
  } catch (error) {
    const [failed] = await db
      .update(ingestJobs)
      .set({
        status: "failed",
        error: (error as Error).message.slice(0, 1000),
        finishedAt: new Date(),
      })
      .where(eq(ingestJobs.id, jobId))
      .returning();
    announceFinished(failed);
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
 * Closes jobs left "running" by a process that died mid-sync, then continues
 * the newest one.
 *
 * Resuming is cheap and safe rather than clever: every fund carries its own
 * watermark, and `selectCandidates` orders by `holdings_synced_at ASC NULLS
 * FIRST`, so a fresh run over the same scope naturally starts with whatever the
 * dead run never reached. There is no checkpoint to store and nothing to
 * reconcile — the work is idempotent, so "resume" is just "run it again".
 *
 * The old row is still closed as failed instead of being reopened: it records
 * what that attempt actually did, and a run that silently spans two processes
 * would make the progress numbers meaningless.
 *
 * Caveat worth knowing: if a sync ever manages to kill the process, this turns
 * a crash into a restart loop that keeps hitting Eastmoney. The runner catches
 * per-fund failures and never throws out of the loop, so that path is not
 * reachable today, but it is the thing to look at first if it ever happens.
 */
export async function resumeOrphanedJobs(): Promise<{ closed: number; resumed: IngestJob | null }> {
  const orphaned = await db
    .update(ingestJobs)
    .set({
      status: "failed",
      error: "interrupted by a server restart",
      finishedAt: new Date(),
    })
    .where(and(inArray(ingestJobs.status, ["queued", "running"])))
    .returning();

  if (orphaned.length === 0) return { closed: 0, resumed: null };

  // Single-flight means at most one was genuinely running; if older rows leaked
  // through an earlier crash, only the newest is worth continuing.
  const newest = orphaned.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));

  const resumed = await startJob({
    provider: newest.provider,
    scope: newest.scope,
    ...(newest.codes ? { codes: newest.codes } : {}),
    limit: newest.fundLimit,
    force: newest.force,
    requestedBy: newest.requestedBy,
  });

  return { closed: orphaned.length, resumed };
}
