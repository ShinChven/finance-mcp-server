/**
 * Small pieces every symbol tab is built from.
 *
 * The tabs show a lot of numbers from sources with patchy coverage, so the
 * one rule here is about absence: a fact with no value is left out of a grid
 * rather than printed as a dash. A grid of dashes reads as a broken page; a
 * shorter grid reads as an instrument that simply does not have those numbers.
 */

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { formatCompact } from "../../lib/format.js";
import { Card } from "../ui.js";

export function Section({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

export interface Fact {
  label: string;
  value: ReactNode | null;
  title?: string;
}

/** Label/value pairs in a responsive grid, skipping the ones with no value. */
export function Facts({ items, columns = 2 }: { items: Fact[]; columns?: 2 | 3 | 4 }) {
  const present = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== "—");
  if (present.length === 0) return <p className="text-xs text-zinc-400">Not published for this listing.</p>;
  // Three or four columns only once there is room for a label and a figure
  // side by side in each; squeezed earlier, the labels wrap into columns of
  // single words.
  const grid =
    columns === 4
      ? "sm:grid-cols-2 2xl:grid-cols-4"
      : columns === 3
        ? "sm:grid-cols-2 2xl:grid-cols-3"
        : "sm:grid-cols-2";
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-1.5 ${grid}`}>
      {present.map((item) => (
        <div
          key={item.label}
          className="flex items-baseline justify-between gap-3 border-b border-zinc-100 py-1 text-sm dark:border-zinc-800/70"
          title={item.title}
        >
          <dt className="text-zinc-500 dark:text-zinc-400">{item.label}</dt>
          <dd className="min-w-0 text-right font-medium break-words tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Loading() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="size-5 animate-spin text-zinc-400" />
    </div>
  );
}

export function Unavailable({ error, what }: { error: unknown; what: string }) {
  return (
    <p className="py-8 text-center text-sm text-amber-600 dark:text-amber-400">
      {what} unavailable right now — {(error as Error).message}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-zinc-500">{children}</p>;
}

/** A money figure, compacted, with its currency when known. */
export function money(value: number | null | undefined, currency?: string | null): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${formatCompact(value)}${currency ? ` ${currency}` : ""}`;
}

export function number(value: number | null | undefined, digits = 2): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** An unsigned percentage — a margin or a yield, where a "+" would read as a change. */
export function percent(value: number | null | undefined, digits = 2): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${value.toFixed(digits)}%`;
}

export function day(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(value.length === 10 ? { timeZone: "UTC" } : {}),
  });
}

/** A row of mutually exclusive choices — one is always selected. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex flex-wrap gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800/70 ${disabled ? "opacity-50" : ""}`}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
          className={
            option.id === value
              ? "cursor-pointer rounded-md bg-white px-2 py-0.5 text-xs font-medium shadow-sm disabled:cursor-not-allowed dark:bg-zinc-700"
              : "cursor-pointer rounded-md px-2 py-0.5 text-xs text-zinc-500 hover:text-zinc-800 disabled:cursor-not-allowed dark:hover:text-zinc-200"
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
