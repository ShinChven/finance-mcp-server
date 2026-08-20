# Coverage & Stability

Every holdings-derived answer carries two numbers alongside it. They are not
diagnostics for the maintainer — they are how you tell a strong claim from a weak
one.

## Coverage

The share of a fund's disclosed weight that could be **classified** into the
sector or market being reported.

> A 60% sector weight at **0.3 coverage** is a much weaker claim than the same
> weight at **0.95**.

Coverage drops when instrument enrichment could not resolve a position — an
uncovered symbol, a listing Yahoo does not carry, or a classification pass that
hit its deadline before reaching every holding.

## Holdings stability

How much of the previous report the fund still holds.

- Index funds sit near **1.0**.
- A **low** score means last quarter's portfolio no longer describes the fund,
  and its inferred exposure should be discounted accordingly.

An exposure vector is a snapshot of a disclosure, not a live portfolio. Stability
is the measure of how much that snapshot is still worth.

## Disclosure completeness

A third property, recorded per fund as `holdings_completeness`:

| Value | Meaning |
|---|---|
| `full` | Weights cover the fund's whole book |
| `top_holdings` | Only the largest positions are disclosed |

Tool responses carry a note derived from it, and **a result mixing both
conventions gets an explicit warning**. Ranking funds by a disclosed sector
weight across conventions measures reporting rules, not portfolios.

This is also why `fundsByHoldings` results should be ranked by
`shareOfDisclosedPercent` rather than `matchedWeightPercent`: a share of net
assets is structurally smaller for a fund that discloses only its top ten.

## Mandates do not drift

`themeToFunds` reports index-tracking matches separately from holdings-derived
ones for the same reason. A declared mandate is a stable fact about a fund; a
holdings snapshot is a measurement with an age and an error bar.
