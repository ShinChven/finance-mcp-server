/**
 * The summary tab: everything a reader checks first, on one screen.
 *
 * Two columns. The wide one is the market's view — statistics, the business,
 * and for a fund its book. The narrow one is the reader's own — their levels on
 * this name, their notes about it — next to the two things most likely to have
 * moved it today: the latest headlines and the names it trades with.
 */

import { Link, useNavigate } from "react-router";
import type { SymbolProfile } from "../../../shared/symbol.js";
import { symbolPath } from "../../../shared/symbol.js";
import type { LevelDraft, LevelPatch } from "../../lib/levels.js";
import { formatPercent } from "../../lib/format.js";
import { useNews, useProfile, useRelated, useSymbolNotes } from "../../lib/symbol-queries.js";
import type { SymbolQuoteResult, SymbolTrackingResult } from "../../lib/types.js";
import { IdeaRow } from "../ideas.js";
import { LevelsPanel } from "../price-levels.js";
import { NewsList } from "./news-tab.js";
import { day, Empty, Facts, Loading, money, number, percent, Section, Unavailable } from "./parts.js";
import { TargetRange } from "./analysis-tab.js";

export function SummaryTab({
  symbol,
  quote,
  tracking,
  levelsBusy,
  onAddLevels,
  onUpdateLevel,
  onRemoveLevel,
  onTab,
  carried,
}: {
  symbol: string;
  /** Query string carried onto another symbol's page. */
  carried: string;
  quote: SymbolQuoteResult;
  tracking: SymbolTrackingResult | undefined;
  levelsBusy: boolean;
  onAddLevels: (levels: LevelDraft[]) => void;
  onUpdateLevel: (levelId: string, patch: LevelPatch) => void;
  onRemoveLevel: (levelId: string) => void;
  onTab: (tab: "news" | "analysis") => void;
}) {
  const navigate = useNavigate();
  const profile = useProfile(symbol);
  const news = useNews(symbol);
  const related = useRelated(symbol);
  const notes = useSymbolNotes(symbol);

  const data = profile.data;
  const currency = data?.financialCurrency ?? quote.identity.currency;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-4">
        {profile.isPending ? (
          <Section title="Key statistics">
            <Loading />
          </Section>
        ) : profile.isError ? (
          <Section title="Key statistics">
            <Unavailable error={profile.error} what="The profile is" />
          </Section>
        ) : data ? (
          <>
            {data.fund ? <FundOverview profile={data} /> : <KeyStatistics profile={data} currency={currency} />}
            {data.company?.summary && <About profile={data} />}
            {data.degraded.length > 0 && (
              <p className="text-[11px] text-zinc-400">
                Yahoo published nothing for: {data.degraded.join(", ")}.
              </p>
            )}
          </>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Section
          title="Your levels"
          action={
            tracking?.listId ? (
              <Link to={`/watchlist?list=${tracking.listId}`} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                Open list
              </Link>
            ) : undefined
          }
        >
          {tracking?.item ? (
            <LevelsPanel
              item={tracking.item}
              busy={levelsBusy}
              onAdd={onAddLevels}
              onUpdate={onUpdateLevel}
              onRemove={onRemoveLevel}
            />
          ) : (
            <p className="text-xs text-zinc-500">
              Star {symbol} to put it on a list. Levels set there — stops, targets, zones — are drawn across this chart
              and checked against every quote.
            </p>
          )}
        </Section>

        {data?.analyst && (data.analyst.targetMean !== null || data.analyst.recommendationKey) && (
          <Section
            title="Analyst targets"
            action={
              <button
                type="button"
                onClick={() => onTab("analysis")}
                className="cursor-pointer text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Details
              </button>
            }
          >
            <TargetRange analyst={data.analyst} price={quote.live.price} />
          </Section>
        )}

        {data && <Upcoming profile={data} />}

        <Section
          title="Latest news"
          action={
            <button
              type="button"
              onClick={() => onTab("news")}
              className="cursor-pointer text-xs text-indigo-600 hover:underline dark:text-indigo-400"
            >
              All news
            </button>
          }
        >
          {news.isPending ? (
            <Loading />
          ) : news.isError ? (
            <Unavailable error={news.error} what="News is" />
          ) : (
            <NewsList articles={(news.data?.articles ?? []).slice(0, 5)} compact />
          )}
        </Section>

        <Section
          title="Your notes"
          action={
            <Link to={`/notes?symbol=${encodeURIComponent(symbol)}`} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              All notes
            </Link>
          }
        >
          {notes.isPending ? (
            <Loading />
          ) : (notes.data?.items.length ?? 0) === 0 ? (
            <p className="text-xs text-zinc-500">
              No notes mention {symbol} yet. Notes your assistant writes about it over MCP show up here.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.data!.items.map((note) => (
                <li key={note.id}>
                  <Link
                    to={`/notes?note=${note.id}`}
                    className="block rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <span className="block truncate text-sm font-medium">{note.title}</span>
                    {note.summary && <span className="line-clamp-2 text-xs text-zinc-500">{note.summary}</span>}
                    <span className="text-[11px] text-zinc-400">{day(note.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Trades with">
          {related.isPending ? (
            <Loading />
          ) : (related.data?.items.length ?? 0) === 0 ? (
            <p className="text-xs text-zinc-500">Yahoo relates nothing to this listing.</p>
          ) : (
            <div className="-mx-2 flex flex-col">
              {related.data!.items.map((idea) => (
                <IdeaRow
                  key={idea.ref}
                  idea={idea}
                  onOpen={() => navigate(`${symbolPath(idea.ref)}${carried}`)}
                />
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function KeyStatistics({ profile, currency }: { profile: SymbolProfile; currency: string | null }) {
  const { valuation, profitability, financials, dividends, shares } = profile;
  return (
    <Section title="Key statistics">
      <div className="flex flex-col gap-5">
        <Group title="Valuation">
          <Facts
            columns={3}
            items={[
              { label: "Market cap", value: money(valuation.marketCap) },
              { label: "Enterprise value", value: money(valuation.enterpriseValue) },
              { label: "P/E (TTM)", value: number(valuation.trailingPe) },
              { label: "Forward P/E", value: number(valuation.forwardPe) },
              { label: "PEG", value: number(valuation.pegRatio), title: "P/E divided by expected earnings growth" },
              { label: "Price / sales", value: number(valuation.priceToSales) },
              { label: "Price / book", value: number(valuation.priceToBook) },
              { label: "EV / revenue", value: number(valuation.evToRevenue) },
              { label: "EV / EBITDA", value: number(valuation.evToEbitda) },
              { label: "EPS (TTM)", value: number(valuation.trailingEps) },
              { label: "Forward EPS", value: number(valuation.forwardEps) },
              { label: "Book value / share", value: number(valuation.bookValuePerShare) },
            ]}
          />
        </Group>
        <Group title="Profitability & growth">
          <Facts
            columns={3}
            items={[
              { label: "Gross margin", value: percent(profitability.grossMarginPercent) },
              { label: "Operating margin", value: percent(profitability.operatingMarginPercent) },
              { label: "Profit margin", value: percent(profitability.profitMarginPercent) },
              { label: "EBITDA margin", value: percent(profitability.ebitdaMarginPercent) },
              { label: "Return on assets", value: percent(profitability.returnOnAssetsPercent) },
              { label: "Return on equity", value: percent(profitability.returnOnEquityPercent) },
              { label: "Revenue growth (YoY)", value: signed(profitability.revenueGrowthPercent) },
              { label: "Earnings growth (YoY)", value: signed(profitability.earningsGrowthPercent) },
            ]}
          />
        </Group>
        <Group title={`Financial health${currency ? ` (${currency})` : ""}`}>
          <Facts
            columns={3}
            items={[
              { label: "Revenue (TTM)", value: money(financials.totalRevenue) },
              { label: "EBITDA", value: money(financials.ebitda) },
              { label: "Operating cash flow", value: money(financials.operatingCashflow) },
              { label: "Free cash flow", value: money(financials.freeCashflow) },
              { label: "Total cash", value: money(financials.totalCash) },
              { label: "Total debt", value: money(financials.totalDebt) },
              { label: "Debt / equity", value: percent(financials.debtToEquity, 1) },
              { label: "Current ratio", value: number(financials.currentRatio) },
              { label: "Quick ratio", value: number(financials.quickRatio) },
            ]}
          />
        </Group>
        <Group title="Dividends & splits">
          <Facts
            columns={3}
            items={[
              { label: "Dividend rate", value: number(dividends.rate) },
              { label: "Yield", value: percent(dividends.yieldPercent) },
              { label: "5-year average yield", value: percent(dividends.fiveYearAverageYieldPercent) },
              { label: "Payout ratio", value: percent(dividends.payoutRatioPercent) },
              { label: "Ex-dividend", value: day(dividends.exDividendDate) },
              { label: "Last split", value: dividends.lastSplitFactor ? `${dividends.lastSplitFactor} · ${day(dividends.lastSplitDate) ?? ""}` : null },
            ]}
          />
        </Group>
        <Group title="Shares & ownership">
          <Facts
            columns={3}
            items={[
              { label: "Beta", value: number(shares.beta) },
              { label: "Shares outstanding", value: money(shares.sharesOutstanding) },
              { label: "Float", value: money(shares.floatShares) },
              { label: "Short % of float", value: percent(shares.shortPercentOfFloat) },
              { label: "Short ratio (days)", value: number(shares.shortRatio) },
              { label: "Held by insiders", value: percent(shares.insidersPercent) },
              { label: "Held by institutions", value: percent(shares.institutionsPercent) },
              { label: "Institutions", value: shares.institutionsCount?.toLocaleString() ?? null },
            ]}
          />
        </Group>
      </div>
    </Section>
  );
}

function signed(value: number | null): string | null {
  return value === null ? null : formatPercent(value);
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-medium tracking-wide text-zinc-400 uppercase">{title}</h3>
      {children}
    </div>
  );
}

function About({ profile }: { profile: SymbolProfile }) {
  const company = profile.company!;
  return (
    <Section title={`About ${profile.name ?? profile.symbol}`}>
      <p className="mb-3 line-clamp-6 text-sm leading-6 text-zinc-600 dark:text-zinc-300" title={company.summary ?? undefined}>
        {company.summary}
      </p>
      <Facts
        columns={3}
        items={[
          { label: "Sector", value: company.sector },
          { label: "Industry", value: company.industry },
          { label: "Country", value: [company.city, company.country].filter(Boolean).join(", ") || null },
          { label: "Employees", value: company.employees?.toLocaleString() ?? null },
          {
            label: "Website",
            value: company.website ? (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {company.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              </a>
            ) : null,
          },
        ]}
      />
      {company.officers.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1.5 text-xs font-medium tracking-wide text-zinc-400 uppercase">Leadership</h3>
          <ul className="grid gap-1 sm:grid-cols-2">
            {company.officers.map((officer) => (
              <li key={`${officer.name}-${officer.title}`} className="text-sm">
                <span className="font-medium">{officer.name}</span>
                {officer.title && <span className="text-zinc-500"> · {officer.title}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function Upcoming({ profile }: { profile: SymbolProfile }) {
  const { events, dividends } = profile;
  const items = [
    {
      label: events.earningsIsEstimate ? "Earnings (estimated)" : "Earnings",
      value:
        events.earningsRange.length > 1
          ? `${day(events.earningsRange[0])} – ${day(events.earningsRange.at(-1))}`
          : day(events.nextEarnings),
    },
    { label: "EPS estimate", value: number(events.epsEstimate) },
    { label: "Revenue estimate", value: money(events.revenueEstimate) },
    { label: "Ex-dividend", value: day(dividends.exDividendDate) },
    { label: "Dividend paid", value: day(dividends.dividendDate) },
  ];
  if (items.every((item) => item.value === null)) return null;
  return (
    <Section title="Calendar">
      <Facts columns={2} items={items} />
    </Section>
  );
}

function FundOverview({ profile }: { profile: SymbolProfile }) {
  const fund = profile.fund!;
  const maxHolding = Math.max(1, ...fund.holdings.map((holding) => holding.percent));
  const maxSector = Math.max(1, ...fund.sectors.map((sector) => sector.percent));
  return (
    <>
      <Section title="Fund overview">
        <Facts
          columns={3}
          items={[
            { label: "Family", value: fund.family },
            { label: "Category", value: fund.category },
            { label: "Legal type", value: fund.legalType },
            { label: "Expense ratio", value: percent(fund.expenseRatioPercent) },
            { label: "Net assets", value: money(fund.totalAssets) },
            { label: "Yield", value: percent(fund.yieldPercent) },
            { label: "YTD return", value: signed(fund.ytdReturnPercent) },
            { label: "3-year return", value: signed(fund.threeYearReturnPercent) },
            { label: "5-year return", value: signed(fund.fiveYearReturnPercent) },
            { label: "Inception", value: day(fund.inceptionDate) },
            { label: "Stocks", value: percent(fund.allocation.stock) },
            { label: "Bonds", value: percent(fund.allocation.bond) },
            { label: "Cash", value: percent(fund.allocation.cash) },
          ]}
        />
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Top holdings">
          {fund.holdings.length === 0 ? (
            <Empty>No holdings published.</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {fund.holdings.map((holding) => (
                <li key={`${holding.symbol}-${holding.name}`} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    {holding.symbol ? (
                      <Link to={symbolPath(holding.symbol)} className="truncate hover:underline">
                        <span className="font-mono text-xs font-semibold">{holding.symbol}</span>{" "}
                        <span className="text-zinc-500">{holding.name}</span>
                      </Link>
                    ) : (
                      <span className="truncate text-zinc-500">{holding.name}</span>
                    )}
                    <span className="shrink-0 tabular-nums">{holding.percent.toFixed(2)}%</span>
                  </div>
                  <Bar fraction={holding.percent / maxHolding} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Sector weights">
          {fund.sectors.length === 0 ? (
            <Empty>No sector breakdown published.</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {fund.sectors.map((sector) => (
                <li key={sector.sector} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="capitalize">{sector.sector}</span>
                    <span className="tabular-nums">{sector.percent.toFixed(2)}%</span>
                  </div>
                  <Bar fraction={sector.percent / maxSector} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

/** A thin magnitude bar, anchored at the left, one hue. */
export function Bar({ fraction }: { fraction: number }) {
  return (
    <div className="mt-0.5 h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div
        className="h-1.5 rounded-full bg-indigo-500"
        style={{ width: `${Math.max(1, Math.min(100, fraction * 100))}%` }}
      />
    </div>
  );
}

