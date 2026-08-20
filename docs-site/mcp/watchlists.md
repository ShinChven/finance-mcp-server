# Watchlist Tools

The user's own saved lists — the same rows the **Watchlists** page shows, so an
assistant and the dashboard are never looking at different things.

| Tool | Purpose | Writes |
|---|---|---|
| `watchlists` | The user's lists, with item counts — the cheap "what exists" call | |
| `watchlist` | One list, priced: live quotes, fund NAV, notes, targets and a breadth summary | |
| `watchlistAdd` | Add instruments or funds, with a note saying why | ✓ |
| `watchlistRemove` | Drop items by symbol or fund code | ✓ |

## One list holds both kinds of thing

Yahoo symbols and 6-digit China fund codes live side by side. A bare 6-digit
reference is read as a **fund code**, since Yahoo's CN listings always carry an
exchange suffix (`600519.SS`); a `kind` argument overrides the guess.

## Three deliberate limits on what an agent can do

- **It cannot delete a list.** Removing one item is a small correction;
  discarding a list throws away accumulated notes and targets. That lives on the
  dashboard, behind a confirmation.
- **It will not fork a list from a near-miss name.** With lists already in place,
  an unrecognised name is an error listing the real ones unless `create: true` is
  passed — otherwise a single typo silently starts a parallel list and the split
  only surfaces later. A user with no lists at all gets their first one made
  automatically; there is nothing to confuse it with.
- **It will not guess between several lists.** With more than one and no name
  given, the call fails and names the candidates.

## Prices are never stored

Items store no prices. Values are fetched per request — Yahoo for instruments,
the local fund cache for funds — and the two are labelled `basis: "market"` and
`basis: "nav"` rather than blended: an intraday quote and a once-daily net asset
value are not the same measurement.

Anything that could not be priced comes back with `available: false` and a
reason, so one bad symbol never costs you the rest of the list.

The summary weights every item equally. A watchlist records no position sizes, so
it cannot express a portfolio return, and the tool does not pretend otherwise.
