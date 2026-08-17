/**
 * CLI entry for the fund relationship ingest.
 *
 *   npm run ingest:cn -- --limit=200
 *   npm run ingest:cn -- --types=index --limit=500
 *   npm run ingest:cn -- --codes=162411,270042 --skip-universe
 *   npm run ingest:cn -- --types=qdii --dry-run
 *
 * Bundled by `scripts/build-server.mjs` into `dist/server/china/ingest-cli.js`
 * so the container can run it from cron without a TypeScript toolchain.
 */

import "../load-env.js";
import { db, pool, waitForDb } from "../db/index.js";
import { yahooFinanceClient } from "../mcp/client.js";
import { previewSync, runIngest } from "./ingest.js";
import { INGEST_SCOPES, isIngestScope, type IngestScope } from "./scope.js";

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

async function main(): Promise<void> {
  const codes = flag("codes")
    ?.split(",")
    .map((code) => code.trim())
    .filter((code) => code !== "");
  const limitRaw = flag("limit");
  const limit = limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);

  if (limit !== undefined && !Number.isFinite(limit)) {
    throw new Error(`--limit must be a number, received "${limitRaw}"`);
  }

  const typesRaw = flag("types");
  if (typesRaw !== undefined && !isIngestScope(typesRaw)) {
    throw new Error(`--types must be one of ${INGEST_SCOPES.join(", ")}, received "${typesRaw}"`);
  }
  const scope: IngestScope =
    typesRaw !== undefined
      ? typesRaw
      : codes !== undefined && codes.length > 0
        ? "codes"
        : "qdii";

  await waitForDb();

  const force = hasFlag("force");

  // `--dry-run` prints the same counts the dashboard shows before a sync, so a
  // cron schedule can be sized without spending any requests.
  if (hasFlag("dry-run")) {
    const preview = await previewSync(db, scope, {
      ...(codes !== undefined && codes.length > 0 ? { codes } : {}),
      ...(limit !== undefined ? { limit } : {}),
      force,
    });
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  const summary = await runIngest({
    db,
    yahoo: yahooFinanceClient,
    scope,
    ...(codes !== undefined && codes.length > 0 ? { codes } : {}),
    ...(limit !== undefined ? { limit } : {}),
    skipUniverse: hasFlag("skip-universe"),
    force,
  });

  console.log(JSON.stringify(summary, null, 2));

  // Errors are per-fund and non-fatal; surface them in the exit code so a cron
  // wrapper can alert without the job having lost the work that did land.
  if (summary.errors.length > 0) {
    console.error(`Completed with ${summary.errors.length} error(s).`);
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
