# Note Tools

The assistant's long-term memory, and the other half of the **Notes** page. A
place to write down what a conversation established — a thesis, a decision, the
reasoning behind it — and find it again later.

Six tools, because storing and finding are different jobs:

| Tool | Purpose | Writes |
|---|---|---|
| `noteCollections` | Collections, tag vocabulary and tagged symbols with counts — the orientation call | |
| `notesSearch` | Search and browse: full text, tags, symbols, collection, status, dates | |
| `noteRead` | Full bodies for up to 5 notes, by id | |
| `noteCreate` | Save what a conversation established | ✓ |
| `noteUpdate` | Edit, append to, re-tag, file or archive one | ✓ |
| `noteDelete` | Remove one note permanently | ✓ |

## The summary is the load-bearing field

`notesSearch` returns titles, summaries and a snippet — **never bodies**. An
agent can scan fifty notes for the two that matter and spend its context on
those, through `noteRead`. The tool descriptions ask for a summary on every write
for exactly that reason.

## Searching works in both languages

Bodies are indexed as a generated `tsvector` (weighted title > summary > body,
`simple` configuration) and matched with `websearch_to_tsquery`, OR-ed with a
substring match over title, summary, body, tags and symbols.

The two branches do different work:

- The **vector** finds whole words anywhere in a long body, and is GIN-indexed.
- The **substring** branch is what finds `降息` inside a Chinese sentence — which
  no stock text-search parser will tokenize apart — and what catches a
  half-remembered partial word.

Ranking is `ts_rank_cd` plus a bump for a title or summary hit, since the
substring branch scores zero on its own.

## Filters compose, and the two rules differ on purpose

- **`tags` narrows** — a note must carry every tag listed. Adding a tag is how
  you cut a result set down.
- **`symbols` widens** — a note matches any symbol listed. *Notes about NVDA or
  AMD* is the question people actually ask; a note is rarely about every ticker
  in a basket.

## Symbols use the watchlist's vocabulary

A bare 6-digit code is a China fund, anything else a Yahoo symbol, uppercased.
One spelling serves both features, so a note about `000834` and a watchlist item
for it agree.

## Three deliberate limits

- **An agent cannot delete a collection.** That would unfile everything in it; it
  lives on the dashboard behind a confirmation. Deleting one *note* — a row it
  could equally have written — is allowed.
- **Archiving is the recommended default.** `status: "archived"` keeps a note
  searchable and out of the listing, and is reversible; deletion is not.
- **It will not fork a collection from a near-miss name.** An unrecognised name is
  an error listing the real ones unless `createCollection: true` is passed.

Nothing an agent writes is hidden from the person who owns it: the same rows are
listed, edited, filed and deleted on `/notes`.
