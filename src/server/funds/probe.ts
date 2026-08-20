/**
 * One request per step, straight at a provider, with nothing stored.
 *
 * The fund pipeline is built to survive a bad source: a listing that cannot be
 * read becomes an empty list, a fund that fails is collected into a summary and
 * the run carries on. That is right for a job walking thousands of funds, and
 * it is exactly wrong when the question is "why has this provider never cached
 * anything?" — the answer is a fetch or a parse failing in a place designed not
 * to interrupt anyone.
 *
 * So this walks the same four provider calls the ingest makes, in the same
 * order, reporting what each returned and what it cost, and it touches no
 * database. It is provider-agnostic on purpose: whichever source is failing,
 * this is the first thing to run against it, and the report is short enough to
 * paste into a bug.
 */

import type { FundProvider } from "./provider.js";

export interface ProbeStep {
  step: "universe" | "details" | "holdings" | "nav";
  ok: boolean;
  ms: number;
  /** What came back, one line — a count, a tracked index, a report date. */
  detail?: string;
  error?: string;
  /** Small enough to read, big enough to recognize a format change. */
  sample?: unknown;
}

export interface ProbeReport {
  provider: string;
  /** The fund the per-fund steps ran against, if any. */
  code: string | null;
  steps: ProbeStep[];
  ok: boolean;
}

async function timed(
  step: ProbeStep["step"],
  run: () => Promise<Omit<ProbeStep, "step" | "ok" | "ms">>,
): Promise<ProbeStep> {
  const startedAt = Date.now();
  try {
    const outcome = await run();
    return { step, ok: true, ms: Date.now() - startedAt, ...outcome };
  } catch (error) {
    return {
      step,
      ok: false,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Walks the provider's four calls, stopping only where continuing is
 * meaningless — with no universe there is no code to ask the other three about,
 * unless the caller named one.
 */
export async function probeProvider(
  provider: FundProvider,
  requested?: string,
): Promise<ProbeReport> {
  const steps: ProbeStep[] = [];
  let code = requested ?? null;

  const universe = await timed("universe", async () => {
    const list = await provider.listUniverse();
    if (code === null) code = list[0]?.code ?? null;
    return {
      detail: `${list.length} funds`,
      sample: list.slice(0, 3),
    };
  });
  steps.push(universe);

  if (code === null) {
    return { provider: provider.id, code: null, steps, ok: false };
  }
  const target = code;

  steps.push(
    await timed("details", async () => {
      const details = await provider.fetchDetails(target);
      return {
        detail: `${details.name ?? "no name"} — tracks ${details.trackingIndex ?? "nothing declared"}`,
        sample: details,
      };
    }),
  );

  steps.push(
    await timed("holdings", async () => {
      const result = await provider.fetchHoldings(target);
      return {
        detail:
          `${result.entries.length} positions, ${result.dropped} dropped` +
          (result.dropReason === undefined ? "" : ` (${result.dropReason})`),
        sample: result.entries.slice(0, 3),
      };
    }),
  );

  steps.push(
    await timed("nav", async () => {
      const points = await provider.fetchNav(target);
      return {
        detail: `${points.length} points, latest ${points[points.length - 1]?.navDate ?? "none"}`,
        sample: points.slice(-2),
      };
    }),
  );

  return {
    provider: provider.id,
    code: target,
    steps,
    ok: steps.every((step) => step.ok),
  };
}

/** The report as a few lines, for a terminal rather than a log parser. */
export function describeProbe(report: ProbeReport): string {
  const lines = report.steps.map((step) => {
    const status = step.ok ? "ok  " : "FAIL";
    const body = step.ok ? (step.detail ?? "") : (step.error ?? "");
    return `  ${status} ${step.step.padEnd(9)} ${String(step.ms).padStart(6)}ms  ${body}`;
  });
  const header =
    `${report.provider}${report.code === null ? "" : ` (${report.code})`}: ` +
    (report.ok ? "all steps returned data" : "at least one step failed");
  return [header, ...lines].join("\n");
}
