/**
 * What the analysts think, and what the technical services say.
 *
 * Two sources, kept visibly apart. The consensus, price targets and rating
 * changes come from the quote summary — sell-side analysts. The outlooks, key
 * levels and valuation call come from the insights feed — third-party research
 * services. They disagree often enough that blending them into one "rating"
 * would hide the most useful thing on the tab.
 *
 * Ratings are a polarity (buy ↔ sell), so they use a diverging pair with a
 * neutral middle rather than a status palette: "hold" is not a warning.
 */

import type { AnalysisView, SymbolProfile } from "../../../shared/symbol.js";
import { formatPrice } from "../../lib/candles.js";
import { formatPercent, signClass } from "../../lib/format.js";
import { useAnalysis, useProfile } from "../../lib/symbol-queries.js";
import { day, Empty, Loading, Section, Unavailable } from "./parts.js";

const RATING_STEPS = [
  { key: "strongBuy", label: "Strong buy", className: "bg-blue-700" },
  { key: "buy", label: "Buy", className: "bg-blue-400" },
  { key: "hold", label: "Hold", className: "bg-zinc-300 dark:bg-zinc-600" },
  { key: "sell", label: "Sell", className: "bg-red-400" },
  { key: "strongSell", label: "Strong sell", className: "bg-red-700" },
] as const;

const PERIOD_LABELS: Record<string, string> = {
  "0m": "This month",
  "-1m": "Last month",
  "-2m": "2 months ago",
  "-3m": "3 months ago",
};

function recommendationLabel(key: string | null): string | null {
  if (key === null) return null;
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Where the price sits among the analysts' targets.
 *
 * Drawn to scale on one track from the lowest target to the highest, with the
 * current price on the same track — so "18% upside to the mean" is something
 * the reader can see rather than a number they have to trust.
 */
export function TargetRange({
  analyst,
  price,
}: {
  analyst: NonNullable<SymbolProfile["analyst"]>;
  price: number | null;
}) {
  const { targetLow, targetHigh, targetMean, targetMedian } = analyst;
  const marks = [targetLow, targetHigh, price].filter((value): value is number => value !== null);
  const low = Math.min(...marks);
  const high = Math.max(...marks);
  const at = (value: number) => (high > low ? ((value - low) / (high - low)) * 100 : 50);
  const upside = price !== null && targetMean !== null && price > 0 ? (targetMean / price - 1) * 100 : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        {analyst.recommendationKey && (
          <span className="font-semibold">{recommendationLabel(analyst.recommendationKey)}</span>
        )}
        {analyst.recommendationMean !== null && (
          <span className="text-xs text-zinc-500" title="1 = strong buy, 5 = strong sell">
            mean score {analyst.recommendationMean.toFixed(2)}
          </span>
        )}
        {analyst.analysts !== null && <span className="text-xs text-zinc-500">{analyst.analysts} analysts</span>}
      </div>
      {targetLow !== null && targetHigh !== null && (
        <div>
          <div className="relative h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="absolute top-0 h-2 rounded-full bg-blue-200 dark:bg-blue-900"
              style={{ left: `${at(targetLow)}%`, width: `${Math.max(1, at(targetHigh) - at(targetLow))}%` }}
            />
            {targetMean !== null && (
              <span
                className="absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-700"
                style={{ left: `${at(targetMean)}%` }}
                title={`Mean target ${formatPrice(targetMean)}`}
              />
            )}
            {price !== null && (
              <span
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-zinc-900 dark:border-zinc-900 dark:bg-zinc-100"
                style={{ left: `${at(price)}%` }}
                title={`Current price ${formatPrice(price)}`}
              />
            )}
          </div>
          <div className="mt-1.5 grid grid-cols-3 text-xs tabular-nums">
            <span className="text-zinc-500">
              Low <span className="text-zinc-800 dark:text-zinc-200">{formatPrice(targetLow)}</span>
            </span>
            <span className="text-center text-zinc-500">
              Mean <span className="font-medium text-zinc-900 dark:text-zinc-100">{targetMean === null ? "—" : formatPrice(targetMean)}</span>
              {targetMedian !== null && <span className="text-zinc-400"> · med {formatPrice(targetMedian)}</span>}
            </span>
            <span className="text-right text-zinc-500">
              High <span className="text-zinc-800 dark:text-zinc-200">{formatPrice(targetHigh)}</span>
            </span>
          </div>
          {upside !== null && (
            <p className="mt-1 text-xs text-zinc-500">
              Mean target is <span className={`font-medium ${signClass(upside)}`}>{formatPercent(upside)}</span> from
              the current price.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RecommendationTrend({ trend }: { trend: NonNullable<SymbolProfile["analyst"]>["trend"] }) {
  const rows = trend.filter((row) => RATING_STEPS.some((step) => row[step.key] > 0));
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const total = RATING_STEPS.reduce((sum, step) => sum + row[step.key], 0);
        return (
          <div key={row.period} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs">
            <span className="text-zinc-500">{PERIOD_LABELS[row.period] ?? row.period}</span>
            <div className="flex h-5 gap-0.5 overflow-hidden rounded">
              {RATING_STEPS.map((step) =>
                row[step.key] === 0 ? null : (
                  <div
                    key={step.key}
                    className={`${step.className} flex items-center justify-center text-[10px] font-medium text-white first:rounded-l last:rounded-r`}
                    style={{ width: `${(row[step.key] / total) * 100}%` }}
                    title={`${step.label}: ${row[step.key]}`}
                  >
                    {row[step.key] / total > 0.08 ? row[step.key] : ""}
                  </div>
                ),
              )}
            </div>
            <span className="text-right text-zinc-400 tabular-nums">{total}</span>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500">
        {RATING_STEPS.map((step) => (
          <span key={step.key} className="inline-flex items-center gap-1">
            <span className={`size-2.5 rounded-sm ${step.className}`} /> {step.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const DIRECTION_CLASS: Record<string, string> = {
  Bullish: "text-blue-700 dark:text-blue-400",
  Bearish: "text-red-600 dark:text-red-400",
  Neutral: "text-zinc-600 dark:text-zinc-300",
};

function Outlooks({ analysis }: { analysis: AnalysisView }) {
  if (analysis.outlooks.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {analysis.outlooks.map((outlook) => (
        <div key={outlook.horizon} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="text-[11px] tracking-wide text-zinc-400 uppercase">
            {outlook.horizon === "short" ? "Short term" : outlook.horizon === "intermediate" ? "Mid term" : "Long term"}
          </div>
          <div className={`text-base font-semibold ${DIRECTION_CLASS[outlook.direction ?? ""] ?? ""}`}>
            {outlook.direction ?? "—"}
          </div>
          {outlook.description && <div className="text-xs text-zinc-500">{outlook.description}</div>}
          {(outlook.sectorDirection || outlook.indexDirection) && (
            <div className="mt-1 text-[11px] text-zinc-400">
              {outlook.sectorDirection && <>Sector {outlook.sectorDirection.toLowerCase()}</>}
              {outlook.sectorDirection && outlook.indexDirection && " · "}
              {outlook.indexDirection && <>Index {outlook.indexDirection.toLowerCase()}</>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function AnalysisTab({ symbol, price }: { symbol: string; price: number | null }) {
  const profile = useProfile(symbol);
  const analysis = useAnalysis(symbol, true);
  const analyst = profile.data?.analyst ?? null;
  const data = analysis.data;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="Analyst consensus">
        {profile.isPending ? (
          <Loading />
        ) : profile.isError ? (
          <Unavailable error={profile.error} what="Analyst data is" />
        ) : analyst === null ? (
          <Empty>No analyst coverage published for this listing.</Empty>
        ) : (
          <div className="flex flex-col gap-5">
            <TargetRange analyst={analyst} price={price} />
            <RecommendationTrend trend={analyst.trend} />
          </div>
        )}
      </Section>

      <Section title="Technical outlook">
        {analysis.isPending ? (
          <Loading />
        ) : analysis.isError ? (
          <Unavailable error={analysis.error} what="Research insights are" />
        ) : data === undefined ||
          (data.outlooks.length === 0 && data.keyTechnicals === null && data.valuation === null) ? (
          <Empty>No technical research published for this listing.</Empty>
        ) : (
          <div className="flex flex-col gap-4">
            <Outlooks analysis={data} />
            {data.keyTechnicals && (
              <div>
                <h3 className="mb-1 text-xs font-medium tracking-wide text-zinc-400 uppercase">Key levels</h3>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums">
                  {data.keyTechnicals.support !== null && (
                    <span>
                      <span className="text-zinc-500">Support</span> {formatPrice(data.keyTechnicals.support)}
                    </span>
                  )}
                  {data.keyTechnicals.resistance !== null && (
                    <span>
                      <span className="text-zinc-500">Resistance</span> {formatPrice(data.keyTechnicals.resistance)}
                    </span>
                  )}
                  {data.keyTechnicals.stopLoss !== null && (
                    <span>
                      <span className="text-zinc-500">Stop</span> {formatPrice(data.keyTechnicals.stopLoss)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Drawn on the chart as dashed indigo lines
                  {data.keyTechnicals.provider ? ` · ${data.keyTechnicals.provider}` : ""}.
                </p>
              </div>
            )}
            {data.valuation && (data.valuation.description || data.valuation.relativeValue) && (
              <div>
                <h3 className="mb-1 text-xs font-medium tracking-wide text-zinc-400 uppercase">Valuation</h3>
                <p className="text-sm">
                  {data.valuation.description ?? data.valuation.relativeValue}
                  {data.valuation.discount && <span className="text-zinc-500"> · {data.valuation.discount}</span>}
                </p>
              </div>
            )}
            {data.recommendation && (
              <p className="text-sm">
                <span className="text-zinc-500">{data.recommendation.provider ?? "Research"} rating:</span>{" "}
                <span className="font-medium">{data.recommendation.rating ?? "—"}</span>
                {data.recommendation.targetPrice !== null && (
                  <span className="text-zinc-500"> · target {formatPrice(data.recommendation.targetPrice)}</span>
                )}
              </p>
            )}
          </div>
        )}
      </Section>

      {data && (data.bull.length > 0 || data.bear.length > 0) && (
        <Section title="Bull and bear case" className="xl:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <CaseList title="Bull" items={data.bull} className="text-blue-700 dark:text-blue-400" />
            <CaseList title="Bear" items={data.bear} className="text-red-600 dark:text-red-400" />
          </div>
        </Section>
      )}

      {data && data.scores.length > 0 && (
        <Section title="Company vs sector">
          <ul className="flex flex-col gap-2">
            {data.scores.map((score) => (
              <li key={score.label} className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-2 text-xs">
                <span className="text-zinc-500">{score.label}</span>
                <div className="flex flex-col gap-0.5">
                  <ScoreBar value={score.company} className="bg-blue-600" label="Company" />
                  <ScoreBar value={score.sector} className="bg-zinc-400 dark:bg-zinc-500" label="Sector" />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-3 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-blue-600" /> Company
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-zinc-400 dark:bg-zinc-500" /> Sector
            </span>
          </div>
        </Section>
      )}

      {data && data.developments.length > 0 && (
        <Section title="Significant developments">
          <ul className="flex flex-col gap-2 text-sm">
            {data.developments.map((entry) => (
              <li key={`${entry.date}-${entry.headline}`}>
                <span className="text-xs text-zinc-400">{day(entry.date)}</span>
                <span className="block">{entry.headline}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {analyst && analyst.upgrades.length > 0 && (
        <Section title="Rating changes" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-1.5 pr-3 font-medium">Date</th>
                  <th className="py-1.5 pr-3 font-medium">Firm</th>
                  <th className="py-1.5 pr-3 font-medium">Action</th>
                  <th className="py-1.5 pr-3 font-medium">Rating</th>
                  <th className="py-1.5 text-right font-medium">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {analyst.upgrades.map((row, index) => (
                  <tr key={`${row.date}-${row.firm}-${index}`}>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-500 tabular-nums">{day(row.date)}</td>
                    <td className="py-1.5 pr-3">{row.firm}</td>
                    <td className="py-1.5 pr-3 capitalize">{actionLabel(row.action)}</td>
                    <td className="py-1.5 pr-3">
                      {row.fromGrade && row.fromGrade !== row.toGrade ? (
                        <>
                          <span className="text-zinc-400">{row.fromGrade}</span> → {row.toGrade}
                        </>
                      ) : (
                        row.toGrade
                      )}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap tabular-nums">
                      {row.currentTarget === null ? (
                        "—"
                      ) : (
                        <>
                          {row.priorTarget !== null && row.priorTarget !== row.currentTarget && (
                            <span className="text-zinc-400">{formatPrice(row.priorTarget)} → </span>
                          )}
                          {formatPrice(row.currentTarget)}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {data && data.reports.length > 0 && (
        <Section title="Research reports" className="xl:col-span-2">
          <ul className="flex flex-col gap-2 text-sm">
            {data.reports.map((report) => (
              <li key={report.id || report.title} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  {report.title}
                  <span className="text-xs text-zinc-500"> · {[report.provider, day(report.date)].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="text-xs text-zinc-500">
                  {report.rating}
                  {report.targetPrice !== null && ` · target ${formatPrice(report.targetPrice)}`}
                  {report.targetPriceStatus && report.targetPriceStatus !== "-" && ` (${report.targetPriceStatus.toLowerCase()})`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-zinc-400">Full reports are behind the providers' own subscriptions.</p>
        </Section>
      )}
    </div>
  );
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    up: "upgrade",
    down: "downgrade",
    init: "initiated",
    main: "maintained",
    reit: "reiterated",
  };
  return labels[action] ?? action;
}

function CaseList({ title, items, className }: { title: string; items: string[]; className: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className={`mb-1 text-xs font-semibold tracking-wide uppercase ${className}`}>{title}</h3>
      <ul className="list-disc space-y-1 pl-4 text-sm text-zinc-700 dark:text-zinc-300">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ScoreBar({ value, className, label }: { value: number | null; className: string; label: string }) {
  if (value === null) return <div className="h-1.5" />;
  return (
    <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" title={`${label}: ${(value * 100).toFixed(0)}`}>
      <div className={`h-1.5 rounded-full ${className}`} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}
