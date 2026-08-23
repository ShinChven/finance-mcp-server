/**
 * Price levels: the rail that shows where an item sits, and the panel that
 * edits the levels behind it.
 *
 * Both read `side` and `distancePercent` off the server rather than deriving
 * them here — the same values the API sorts and filters on, so the ladder, the
 * rail and the `near` facet cannot disagree about what is close.
 */

import { useState } from "react";
import { Check, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Modal } from "./modal.js";
import { Button, Card, Input, Label, Select } from "./ui.js";
import { formatRelative } from "../lib/format.js";
import { parseLevelLines, type LevelDraft, type LevelPatch } from "../lib/levels.js";
import type { WatchlistItem, WatchlistLevel } from "../lib/types.js";
import {
  LEVEL_KIND_LABELS,
  NEAR_LEVEL_PERCENT,
  WATCHLIST_LEVEL_KINDS,
  type WatchlistLevelKind,
} from "../../shared/watchlist.js";

/** A level nobody is waiting for any more is drawn as history. */
function isDone(level: WatchlistLevel): boolean {
  return level.status !== "active" || level.expired;
}

function isNear(level: WatchlistLevel): boolean {
  return (
    !isDone(level) &&
    level.distancePercent !== null &&
    Math.abs(level.distancePercent) <= NEAR_LEVEL_PERCENT
  );
}

function toneClass(level: WatchlistLevel): string {
  if (isDone(level)) return "bg-zinc-300 dark:bg-zinc-600";
  if (level.side === "below") return "bg-emerald-500";
  if (level.side === "above") return "bg-rose-500";
  return "bg-indigo-400";
}

function formatLevelPrice(level: WatchlistLevel): string {
  const digits = level.price < 10 ? 3 : 2;
  const low = level.price.toFixed(digits);
  return level.priceHigh === null ? low : `${low}–${level.priceHigh.toFixed(digits)}`;
}

function formatMove(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/**
 * Where the price sits among the levels, at a glance.
 *
 * Drawn to scale between the outermost numbers rather than evenly spaced: a
 * stop 20% away and a target 2% away should not look equidistant, which is the
 * only thing this row has space to say.
 */
export function PriceRail({ item, tall = false }: { item: WatchlistItem; tall?: boolean }) {
  const price = item.live.price;
  const points = [
    ...item.levels.flatMap((level) => [level.price, level.priceHigh ?? level.price]),
    ...(price === null ? [] : [price]),
    ...(item.entryPrice === null ? [] : [item.entryPrice]),
  ];
  if (points.length < 2) return null;

  // Centred on the current price, so the middle of every rail on the page means
  // the same thing and two rows can be compared at a glance. The half-span
  // never drops below 5%: without a floor, an item whose only level is 0.5%
  // away would fill the whole rail and look as far off as one 30% away.
  const anchor = price ?? item.entryPrice ?? (Math.min(...points) + Math.max(...points)) / 2;
  const reach = Math.max(
    ...points.map((value) => Math.abs(value - anchor)),
    Math.abs(anchor) * 0.05,
  );
  const half = reach * 1.12;
  const at = (value: number): string =>
    `${(((value - (anchor - half)) / (half * 2)) * 100).toFixed(2)}%`;

  return (
    <div
      className={`relative w-full rounded-full bg-zinc-100 dark:bg-zinc-800 ${tall ? "h-3" : "h-2"}`}
      title={`${item.levels.length} level${item.levels.length === 1 ? "" : "s"} between ${Math.min(
        ...points,
      )} and ${Math.max(...points)}`}
    >
      {item.entryPrice !== null && (
        <span
          className="absolute top-0 bottom-0 w-px bg-zinc-400 dark:bg-zinc-500"
          style={{ left: at(item.entryPrice) }}
          title={`Added at ${item.entryPrice}`}
        />
      )}
      {item.levels.map((level) => (
        <span
          key={level.id}
          className={`absolute top-0 bottom-0 rounded-sm ${toneClass(level)} ${
            isNear(level) ? "animate-pulse" : ""
          }`}
          style={{
            left: at(level.price),
            width:
              level.priceHigh === null
                ? "2px"
                : `max(2px, calc(${at(level.priceHigh)} - ${at(level.price)}))`,
          }}
          title={`${LEVEL_KIND_LABELS[level.kind]} ${formatLevelPrice(level)}${
            level.label === null ? "" : ` · ${level.label}`
          }`}
        />
      ))}
      {price !== null && (
        <span
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600 ring-2 ring-white dark:bg-indigo-400 dark:ring-zinc-900 ${
            tall ? "size-3" : "size-2.5"
          }`}
          style={{ left: at(price) }}
          title={`Now ${price}`}
        />
      )}
    </div>
  );
}

/** The one-line reading of the rail, for the table cell next to it. */
export function NearestSummary({ item }: { item: WatchlistItem }) {
  const { above, below } = item.nearest;
  if (item.levels.length === 0) {
    return <span className="text-zinc-300 dark:text-zinc-600">—</span>;
  }

  const counts = { above: 0, below: 0 };
  for (const level of item.levels) {
    if (isDone(level)) continue;
    if (level.side === "above") counts.above += 1;
    if (level.side === "below") counts.below += 1;
  }

  return (
    <span className="inline-flex items-center gap-2 text-[11px] tabular-nums">
      <span className={above === null ? "text-zinc-300 dark:text-zinc-600" : "text-rose-600 dark:text-rose-400"}>
        {above === null ? "—" : `${formatLevelPrice(above)} ↑${counts.above}`}
      </span>
      <span className="text-zinc-300 dark:text-zinc-700">/</span>
      <span className={below === null ? "text-zinc-300 dark:text-zinc-600" : "text-emerald-600 dark:text-emerald-400"}>
        {below === null ? "—" : `${formatLevelPrice(below)} ↓${counts.below}`}
      </span>
    </span>
  );
}

/**
 * The ladder, ordered by price with the market in the middle.
 *
 * Not grouped by kind, though the rows carry it: what a person checks here is
 * what the price runs into next, and that question is answered by distance,
 * not by whether someone once called a number support or a target.
 */
export function LevelsPanel({
  item,
  busy,
  onAdd,
  onUpdate,
  onRemove,
  onClose,
}: {
  item: WatchlistItem;
  busy: boolean;
  onAdd: (levels: LevelDraft[]) => void;
  onUpdate: (levelId: string, patch: LevelPatch) => void;
  onRemove: (levelId: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<WatchlistLevel | null>(null);
  const price = item.live.price;
  const above = item.levels.filter((level) => level.side === "above");
  const rest = item.levels.filter((level) => level.side !== "above");

  return (
    <Card className="h-fit p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm font-medium">{item.ref}</div>
          {item.name && <div className="truncate text-xs text-zinc-400">{item.name}</div>}
        </div>
        <button
          onClick={onClose}
          aria-label="Close price levels"
          className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mb-3 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-zinc-500">
          {item.entryPrice === null ? (
            "No entry price"
          ) : (
            <>
              Added at <span className="tabular-nums">{item.entryPrice}</span>
              {item.entryAt && <> · {formatRelative(item.entryAt)}</>}
            </>
          )}
        </span>
        <span
          className={`tabular-nums ${
            item.sinceEntryPercent === null || item.sinceEntryPercent === 0
              ? "text-zinc-400"
              : item.sinceEntryPercent > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
          }`}
        >
          {formatMove(item.sinceEntryPercent)}
        </span>
      </div>

      <div className="mb-4">
        <PriceRail item={item} tall />
      </div>

      {item.levels.length === 0 ? (
        <p className="mb-3 text-xs text-zinc-400">
          No levels yet. Record where this runs into resistance, where you would add, and where the
          idea is wrong — an assistant reads and writes the same rows over MCP.
        </p>
      ) : (
        <div className="mb-3 space-y-0.5">
          {above.map((level) => (
            <LevelRow
              key={level.id}
              level={level}
              onEdit={() => setEditing(level)}
              onUpdate={(patch) => onUpdate(level.id, patch)}
              onRemove={() => onRemove(level.id)}
            />
          ))}

          <div className="flex items-center gap-2 py-1.5 text-[11px] text-zinc-400">
            <span className="h-px flex-1 bg-indigo-200 dark:bg-indigo-500/40" />
            <span className="tabular-nums">{price === null ? "no price" : price}</span>
            <span className="h-px flex-1 bg-indigo-200 dark:bg-indigo-500/40" />
          </div>

          {rest.map((level) => (
            <LevelRow
              key={level.id}
              level={level}
              onEdit={() => setEditing(level)}
              onUpdate={(patch) => onUpdate(level.id, patch)}
              onRemove={() => onRemove(level.id)}
            />
          ))}
        </div>
      )}

      <QuickAdd price={price} busy={busy} onAdd={onAdd} />

      {editing && (
        <LevelDialog
          level={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSubmit={(patch) => {
            onUpdate(editing.id, patch);
            setEditing(null);
          }}
        />
      )}
    </Card>
  );
}

function LevelRow({
  level,
  onEdit,
  onUpdate,
  onRemove,
}: {
  level: WatchlistLevel;
  onEdit: () => void;
  onUpdate: (patch: LevelPatch) => void;
  onRemove: () => void;
}) {
  const done = isDone(level);
  const label = level.label ?? level.note ?? "";
  return (
    <div
      className={`group rounded px-1 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
        done ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`size-1.5 shrink-0 rounded-full ${toneClass(level)}`} />
        <span className={`shrink-0 tabular-nums ${done ? "line-through" : ""}`}>
          {formatLevelPrice(level)}
        </span>
        <span className="shrink-0 text-[10px] text-zinc-400 uppercase">
          {LEVEL_KIND_LABELS[level.kind]}
        </span>
        <span
          className={`flex-1 text-right tabular-nums ${
            isNear(level) ? "font-medium text-amber-600 dark:text-amber-400" : "text-zinc-400"
          }`}
        >
          {formatMove(level.distancePercent)}
        </span>
        <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => onUpdate({ status: level.status === "active" ? "hit" : "active" })}
            aria-label={level.status === "active" ? "Mark as hit" : "Make active again"}
            className="cursor-pointer rounded p-0.5 text-zinc-400 hover:text-emerald-600"
          >
            {level.status === "active" ? (
              <Check className="size-3" />
            ) : (
              <RotateCcw className="size-3" />
            )}
          </button>
          <button
            onClick={onEdit}
            aria-label={`Edit level ${level.price}`}
            className="cursor-pointer rounded p-0.5 text-zinc-400 hover:text-indigo-600"
          >
            <Pencil className="size-3" />
          </button>
          <button
            onClick={onRemove}
            aria-label={`Delete level ${level.price}`}
            className="cursor-pointer rounded p-0.5 text-zinc-400 hover:text-red-600"
          >
            <Trash2 className="size-3" />
          </button>
        </span>
      </div>

      {(label !== "" || level.source === "agent" || level.expired) && (
        <div className="truncate pl-3.5 text-[11px] text-zinc-500" title={label}>
          {label}
          {level.source === "agent" && (
            <span className="ml-1 rounded bg-indigo-50 px-1 text-[9px] text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
              agent
            </span>
          )}
          {level.expired && <span className="ml-1 text-[9px] text-amber-600">expired</span>}
        </div>
      )}
    </div>
  );
}

/**
 * One level at a time, or several pasted at once.
 *
 * The kind defaults to whichever side of the price the number lands on, so the
 * common case — reading levels off a chart — is a number and a few words.
 */
function QuickAdd({
  price,
  busy,
  onAdd,
}: {
  price: number | null;
  busy: boolean;
  onAdd: (levels: LevelDraft[]) => void;
}) {
  const [bulk, setBulk] = useState(false);
  const [text, setText] = useState("");
  const drafts = parseLevelLines(text, price);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (drafts.length === 0) return;
        onAdd(drafts);
        setText("");
      }}
      className="border-t border-zinc-100 pt-3 dark:border-zinc-800"
    >
      {bulk ? (
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          placeholder={"185 prior high\n168 20-day MA\nstop 152 thesis breaks"}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      ) : (
        <Input
          value={text}
          onChange={(event) => setText(event.target.value.replace(/\n/g, " "))}
          placeholder="185 prior high"
        />
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setBulk(!bulk)}
          className="cursor-pointer text-[11px] text-zinc-400 hover:text-indigo-600"
        >
          {bulk ? "One at a time" : "Paste several"}
        </button>
        <Button type="submit" size="sm" disabled={busy || drafts.length === 0}>
          <Plus className="size-3.5" /> Add {drafts.length > 1 ? drafts.length : ""}
        </Button>
      </div>

      {drafts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {drafts.map((draft, index) => (
            <span
              key={`${draft.kind}-${draft.price}-${index}`}
              className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800"
            >
              {draft.price}
              {draft.priceHigh ? `–${draft.priceHigh}` : ""} · {LEVEL_KIND_LABELS[draft.kind]}
            </span>
          ))}
        </div>
      )}
      <p className="mt-1 text-[11px] text-zinc-400">
        A price and a label. The kind follows which side of the current price it lands on — name it
        (<code>stop 152</code>) to override, or give a range (<code>125-135</code>) for a zone.
      </p>
    </form>
  );
}

function LevelDialog({
  level,
  busy,
  onClose,
  onSubmit,
}: {
  level: WatchlistLevel;
  busy: boolean;
  onClose: () => void;
  onSubmit: (patch: LevelPatch) => void;
}) {
  const [kind, setKind] = useState<WatchlistLevelKind>(level.kind);
  const [price, setPrice] = useState(String(level.price));
  const [priceHigh, setPriceHigh] = useState(level.priceHigh === null ? "" : String(level.priceHigh));
  const [label, setLabel] = useState(level.label ?? "");
  const [note, setNote] = useState(level.note ?? "");
  const [validUntil, setValidUntil] = useState(level.validUntil ?? "");

  const number = (value: string): number | null => {
    const parsed = Number(value.trim());
    return value.trim() === "" || !Number.isFinite(parsed) ? null : parsed;
  };

  return (
    <Modal title={`Level · ${level.price}`} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = number(price);
          if (parsed === null || parsed <= 0) return;
          onSubmit({
            kind,
            price: parsed,
            priceHigh: number(priceHigh),
            label: label.trim() === "" ? null : label.trim(),
            note: note.trim() === "" ? null : note.trim(),
            validUntil: validUntil.trim() === "" ? null : validUntil.trim(),
          });
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Kind</Label>
            <Select
              className="w-full"
              value={kind}
              onChange={(event) => setKind(event.target.value as WatchlistLevelKind)}
            >
              {WATCHLIST_LEVEL_KINDS.map((option) => (
                <option key={option} value={option}>
                  {LEVEL_KIND_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Valid until</Label>
            <Input
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
              placeholder="YYYY-MM-DD"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Price</Label>
            <Input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" />
          </div>
          <div>
            <Label>High edge (zone)</Label>
            <Input
              value={priceHigh}
              onChange={(event) => setPriceHigh(event.target.value)}
              inputMode="decimal"
              placeholder="Blank for a single price"
            />
          </div>
        </div>
        <div>
          <Label>Label</Label>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Where the number comes from"
            maxLength={80}
          />
        </div>
        <div>
          <Label>Note</Label>
          <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
        </div>
        <div className="flex justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onSubmit({ status: "invalidated" })}
            disabled={busy || level.status === "invalidated"}
          >
            Invalidate
          </Button>
          <span className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}
