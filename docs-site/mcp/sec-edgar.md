# SEC EDGAR Tools

For US issuers, EDGAR is the source of record that Yahoo mirrors — late,
partially, and without provenance. These two tools read it directly.

| Tool | Purpose |
|---|---|
| `secFilings` | An issuer's filing index, newest first, with direct document URLs |
| `secFinancials` | As-reported XBRL financials as a time series, with the filing behind every value |

## When to use these over the Yahoo statement tools

- You need **as-reported** rather than vendor-normalised figures.
- You need **restatement-accurate** history.
- You need a **citable filing URL** for a number.

`secFinancials` deduplicates each period to its latest restatement, and carries
the `us-gaap` concept and the accession number for every value — so a figure can
always be traced back to the document it came from.

## Coverage limits, stated rather than hidden

Coverage is SEC registrants only:

- Non-US listings and most ADRs have **no CIK**.
- Filers predating XBRL have **no company facts**.

Both tools say so explicitly instead of returning an empty result, so an agent
can tell "this issuer does not file with the SEC" apart from "this query found
nothing".

## Configuration

EDGAR requires a descriptive `User-Agent` with a contact address on every
request, or it starts rejecting them. Set `SEC_EDGAR_CONTACT_EMAIL` — see the
[Configuration Reference](/guide/configuration).
