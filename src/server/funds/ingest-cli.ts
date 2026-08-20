/**
 * CLI entry for the fund relationship ingest.
 *
 *   npm run ingest -- --provider=eastmoney --scope=qdii --limit=200
 *   npm run ingest -- --provider=ishares --scope=all
 *   npm run ingest -- --provider=eastmoney --codes=162411,270042 --skip-universe
 *   npm run ingest -- --provider=ishares --scope=international --dry-run
 *   npm run ingest -- --provider=ishares --probe
 *
 * Bundled by `scripts/build-server.mjs` into `dist/server/funds/ingest-cli.js`
 * so the container can run it from cron without a TypeScript toolchain.
 */

import "../load-env.js";
import {
  isProviderId,
  isProviderScope,
  PROVIDER_IDS,
  providerScopes,
  type ProviderId,
} from "../../shared/funds.js";
import { db, pool, waitForDb } from "../db/index.js";
import { yahooFinanceClient } from "../mcp/client.js";
import { previewSync, runIngest } from "./ingest.js";
import { describeProbe, probeProvider } from "./probe.js";
import { getProvider } from "./providers/index.js";

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

async function main(): Promise<void> {
  const providerRaw = flag("provider") ?? "eastmoney";
  if (!isProviderId(providerRaw)) {
    throw new Error(
      `--provider must be one of ${PROVIDER_IDS.join(", ")}, received "${providerRaw}"`,
    );
  }
  const providerId: ProviderId = providerRaw;
  const provider = getProvider(providerId);

  const codes = flag("codes")
    ?.split(",")
    .map((code) => code.trim())
    .filter((code) => code !== "");
  const limitRaw = flag("limit");
  const limit = limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);

  if (limit !== undefined && !Number.isFinite(limit)) {
    throw new Error(`--limit must be a number, received "${limitRaw}"`);
  }

  // `--types` was the China-only spelling; kept as an alias so existing cron
  // entries do not silently fall through to the default scope.
  const scopeRaw = flag("scope") ?? flag("types");
  if (scopeRaw !== undefined && !isProviderScope(providerId, scopeRaw)) {
    const available = providerScopes(providerId)
      .map((scope) => scope.id)
      .join(", ");
    throw new Error(
      `--scope must be one of ${available} for provider "${providerId}", received "${scopeRaw}"`,
    );
  }
  const scope =
    scopeRaw !== undefined
      ? scopeRaw
      : codes !== undefined && codes.length > 0
        ? "codes"
        : provider.descriptor.defaultScope;

  // `--probe` answers "is this source reachable and still shaped the way the
  // parsers expect?" with four requests and no writes, so it needs neither a
  // database nor a scope. First thing to reach for when a provider caches
  // nothing: the pipeline is built to swallow exactly the failures it prints.
  if (hasFlag("probe")) {
    const report = await probeProvider(provider, codes?.[0]);
    console.log(describeProbe(report));
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  await waitForDb();

  const force = hasFlag("force");

  // `--dry-run` prints the same counts the dashboard shows before a sync, so a
  // cron schedule can be sized without spending any requests.
  if (hasFlag("dry-run")) {
    const preview = await previewSync(db, provider, scope, {
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
    provider,
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
