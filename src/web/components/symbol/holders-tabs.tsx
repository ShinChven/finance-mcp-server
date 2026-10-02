/**
 * Who holds this listing, and what it has filed.
 *
 * "Held by funds" reads the local holdings index — the one view on this page
 * that no market-data site can offer, because it spans China public funds and
 * US ETFs in one table. Institutional and insider tables come from the quote
 * summary and sit beside it. Filings come straight from EDGAR.
 */

import { Link } from "react-router";
import { ExternalLink } from "lucide-react";
import { FILING_FORMS, type SymbolPageParams } from "../../../shared/symbol.js";
import { formatCompact, formatPercent, signClass } from "../../lib/format.js";
import { useFilings, useFundHolders, useProfile } from "../../lib/symbol-queries.js";
import { day, Empty, Loading, Section, Unavailable } from "./parts.js";
import { Bar } from "./summary-tab.js";

export function FundsTab({ symbol }: { symbol: string }) {
  const holders = useFundHolders(symbol, true);
  const profile = useProfile(symbol);
  const ownership = profile.data?.ownership;
  const data = holders.data;
  const maxWeight = Math.max(1, ...(data?.funds ?? []).map((fund) => fund.weightPercent));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="Funds in the local index" className="xl:col-span-2">
        {holders.isPending ? (
          <Loading />
        ) : holders.isError ? (
          <Unavailable error={holders.error} what="The fund index is" />
        ) : data === undefined || data.funds.length === 0 ? (
          <Empty>
            No cached fund discloses a position in {symbol}. The index only covers funds whose holdings have been
            ingested — open more on the{" "}
            <Link to="/funds" className="text-indigo-600 hover:underline dark:text-indigo-400">
              Funds
            </Link>{" "}
            page to widen it.
          </Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                    <th className="py-2 pr-3 text-left font-medium">Fund</th>
                    <th className="py-2 pr-3 text-left font-medium">Market</th>
                    <th className="py-2 pr-3 text-left font-medium">Tracks</th>
                    <th className="w-48 py-2 pr-3 text-right font-medium">Weight</th>
                    <th className="py-2 text-right font-medium">Report</th>
                  </tr>
                </thead>
                <tbody>
                  {data.funds.map((fund) => (
                    <tr key={fund.code} className="border-b border-zinc-100 dark:border-zinc-800/70">
                      <td className="py-1.5 pr-3">
                        <Link to={`/funds?fund=${encodeURIComponent(fund.code)}`} className="hover:underline">
                          <span className="font-mono text-xs font-semibold">{fund.code}</span>{" "}
                          <span className="text-zinc-600 dark:text-zinc-300">{fund.name}</span>
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3 text-xs text-zinc-500">{fund.domicile}</td>
                      <td className="py-1.5 pr-3 text-xs text-zinc-500">{fund.isIndexFund ? (fund.trackingIndex ?? "Index") : "Active"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {fund.weightPercent.toFixed(2)}%
                        <Bar fraction={fund.weightPercent / maxWeight} />
                      </td>
                      <td className="py-1.5 text-right text-xs text-zinc-500 tabular-nums">{day(fund.reportDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">{data.note}</p>
          </>
        )}
      </Section>

      {ownership && ownership.institutions.length > 0 && (
        <Section title="Top institutions">
          <HolderTable rows={ownership.institutions} />
        </Section>
      )}
      {ownership && ownership.funds.length > 0 && (
        <Section title="Top mutual funds">
          <HolderTable rows={ownership.funds} />
        </Section>
      )}
      {ownership && ownership.insiders.length > 0 && (
        <Section title="Insider transactions" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-3 text-left font-medium">Date</th>
                  <th className="py-2 pr-3 text-left font-medium">Insider</th>
                  <th className="py-2 pr-3 text-left font-medium">Transaction</th>
                  <th className="py-2 pr-3 text-right font-medium">Shares</th>
                  <th className="py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {ownership.insiders.map((row, index) => (
                  <tr key={`${row.date}-${row.name}-${index}`} className="border-b border-zinc-100 dark:border-zinc-800/70">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-500 tabular-nums">{day(row.date)}</td>
                    <td className="py-1.5 pr-3">
                      {row.name}
                      {row.relation && <span className="text-xs text-zinc-500"> · {row.relation}</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-zinc-600 dark:text-zinc-300">{row.text ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{row.shares === null ? "—" : formatCompact(row.shares)}</td>
                    <td className="py-1.5 text-right tabular-nums">{row.value === null ? "—" : formatCompact(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

function HolderTable({ rows }: { rows: NonNullable<ReturnType<typeof useProfile>["data"]>["ownership"]["institutions"] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
          <th className="py-2 pr-3 text-left font-medium">Holder</th>
          <th className="py-2 pr-3 text-right font-medium">% held</th>
          <th className="py-2 pr-3 text-right font-medium">Value</th>
          <th className="py-2 text-right font-medium">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.organization} className="border-b border-zinc-100 dark:border-zinc-800/70">
            <td className="max-w-0 truncate py-1.5 pr-3" title={row.organization}>
              {row.organization}
            </td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{row.percentHeld === null ? "—" : `${row.percentHeld.toFixed(2)}%`}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{row.value === null ? "—" : formatCompact(row.value)}</td>
            <td className={`py-1.5 text-right tabular-nums ${signClass(row.percentChange)}`}>
              {row.percentChange === null ? "—" : formatPercent(row.percentChange)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FilingsTab({
  symbol,
  params,
  update,
}: {
  symbol: string;
  params: SymbolPageParams;
  update: (patch: Partial<SymbolPageParams>) => void;
}) {
  const filings = useFilings(symbol, params.form, true);
  const data = filings.data;
  const forms = ["", ...FILING_FORMS];

  return (
    <Section
      title={data?.company ? `${data.company.name} · CIK ${data.company.cik}` : "SEC filings"}
      action={
        <div className="flex flex-wrap gap-1" role="group" aria-label="Form">
          {forms.map((form) => (
            <button
              key={form || "all"}
              type="button"
              aria-pressed={params.form === form}
              onClick={() => update({ form })}
              className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] ${
                params.form === form
                  ? "border-indigo-500 bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {form || "All"}
            </button>
          ))}
        </div>
      }
    >
      {filings.isPending ? (
        <Loading />
      ) : filings.isError ? (
        <Unavailable error={filings.error} what="EDGAR is" />
      ) : data?.unsupported ? (
        <Empty>{data.unsupported}</Empty>
      ) : data === undefined || data.filings.length === 0 ? (
        <Empty>No {params.form || ""} filings in EDGAR's recent index.</Empty>
      ) : (
        <div className={`overflow-x-auto ${filings.isPlaceholderData ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3 text-left font-medium">Filed</th>
                <th className="py-2 pr-3 text-left font-medium">Form</th>
                <th className="py-2 pr-3 text-left font-medium">Period</th>
                <th className="py-2 text-left font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {data.filings.map((filing) => (
                <tr key={filing.accessionNumber} className="border-b border-zinc-100 dark:border-zinc-800/70">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-500 tabular-nums">{filing.filingDate}</td>
                  <td className="py-1.5 pr-3">
                    <a
                      href={filing.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {filing.form}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-500 tabular-nums">{filing.reportDate ?? "—"}</td>
                  <td className="py-1.5 text-zinc-600 dark:text-zinc-300">
                    {filing.description ?? "—"}
                    {filing.items.length > 0 && <span className="text-xs text-zinc-400"> · items {filing.items.join(", ")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
