# Watchlist Tools

The user's own saved lists — the same rows the **Watchlists** page shows, so an
assistant and the dashboard are never looking at different things.

| Tool | Purpose | Writes |
|---|---|---|
| `watchlists` | The user's lists, with item counts — the cheap "what exists" call | |
| `watchlist` | One list, priced: live quotes, fund NAV, notes, price levels and a breadth summary | |
| `watchlistAdd` | Add instruments or funds, with a note saying why | ✓ |
| `watchlistLevels` | Record, revise and retire the price levels on one item | ✓ |
| `watchlistRemove` | Drop items by symbol or fund code | ✓ |

## One list holds both kinds of thing

Yahoo symbols and 6-digit China fund codes live side by side. A bare 6-digit
reference is read as a **fund code**, since Yahoo's CN listings always carry an
exchange suffix (`600519.SS`); a `kind` argument overrides the guess.

## Three deliberate limits on what an agent can do

- **It cannot delete a list.** Removing one item is a small correction;
  discarding a list throws away accumulated notes and price levels. That lives on
  the dashboard, behind a confirmation.
- **It will not fork a list from a near-miss name.** With lists already in place,
  an unrecognised name is an error listing the real ones unless `create: true` is
  passed — otherwise a single typo silently starts a parallel list and the split
  only surfaces later. A user with no lists at all gets their first one made
  automatically; there is nothing to confuse it with.
- **It will not guess between several lists.** With more than one and no name
  given, the call fails and names the candidates.

## Price levels: what the analysis concluded

An item carries any number of levels — support, resistance, targets, stops, entry
zones — each with a label saying where the number came from. This is the part of
a conversation that is otherwise lost when it ends: a symbol on its own says only
that someone was interested once.

```json
{ "ref": "NVDA", "add": [
  { "kind": "resistance", "price": 185, "label": "prior high" },
  { "kind": "stop", "price": 152, "note": "thesis breaks below the gap" }
] }
```

Three things follow from how they are stored:

- **A level records intent, not direction.** "Upside target 200" stops being
  above the price the moment it trades through 200. Which side of the market a
  level sits on (`side`), how far the price must move to reach it
  (`distancePercent`, as a percentage of the current price) and whether it is
  past its `validUntil` date are computed on every read, never stored.
- **Re-running an analysis converges.** Adding a level that already exists at the
  same price and kind is skipped, not duplicated, so an agent working through the
  same reasoning twice leaves one row.
- **Levels are addressable.** `watchlistLevels` revises exactly the level whose
  reasoning changed, by the id `watchlist` returns — `status: "hit"` when the
  price got there, `invalidated` when the call no longer holds. Deleting is for
  mistakes; a level that simply resolved is worth keeping.

Levels an agent writes are marked `source: "agent"` and shown as such on the
dashboard, next to the ones the user typed.

## Items come back in the user's own order

A watchlist is ordered by hand — dragged into shape on the dashboard — and
`watchlist` reads it back in that order rather than by add date. The order is
information: why three names sit at the top of a list is in the user's head, not
in any column an agent could sort by. There is no tool for rewriting it, for the
same reason there is none for deleting a list: rearranging someone's list is not
a correction an assistant should make on its own.

## The entry price is captured, not asked for

Adding an item records what it was worth at that moment. It is the one price
stored anywhere, because "what was it at when we started watching this" is only
answerable then — a field the caller had to remember to fill would be empty on
exactly the rows that needed it. `sinceEntryPercent` is measured from it. Pass
`entryPrice` explicitly only to backfill something acquired before it was tracked;
it is not a cost basis, and a watchlist still records no position sizes.

## Prices are never stored

Items store no prices. Values are fetched per request — Yahoo for instruments,
the local fund cache for funds — and the two are labelled `basis: "market"` and
`basis: "nav"` rather than blended: an intraday quote and a once-daily net asset
value are not the same measurement.

Anything that could not be priced comes back with `available: false` and a
reason, so one bad symbol never costs you the rest of the list.

The summary weights every item equally. A watchlist records no position sizes, so
it cannot express a portfolio return, and the tool does not pretend otherwise.
