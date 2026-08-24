# When iShares Is Blocked

The iShares provider reads two keyless public endpoints, and BlackRock fronts
both with Akamai Bot Manager. Most of the time a browser-like `User-Agent` —
which the client always sends — is all they ask for. It is not always enough,
because the block can land on **the caller rather than the request**: from a
host whose egress IP Akamai has already judged, the fund index answers `403`
from `AkamaiGHost`, the CDN's own block page, and the request never reaches
iShares at all. No header changes that.

`ISHARES_PROXY_BASE` and `ISHARES_PROXY_TOKEN` route those two requests, and
only those two, through a relay that egresses somewhere else.

## Confirm that is what is happening

```bash
npm run ingest -- --provider=ishares --probe
```

A block looks like this — the universe step fails and nothing downstream runs:

```
ishares: at least one step failed [direct]
  FAIL universe     278ms  iShares request failed (403): https://www.ishares.com/us/product-screener/...
```

Two things in that output matter. The `403` says the request was refused before
it reached iShares. The `[direct]` says which route was taken — the probe prints
this on every run, because a direct fetch and a relayed one fail *identically*
otherwise.

If instead you see an error naming an HTML page, the request was answered with
an interstitial rather than a refusal. Same cause, same fix.

## The relay

Any HTTP endpoint that accepts a target URL and returns the response verbatim
will do. [`fintools-ishares-proxy`](https://github.com/ShinChven/fintools-ishares-proxy)
is a ~100-line Cloudflare Worker built for this: a bearer token gates it, a host
allowlist bounds it to `www.ishares.com`, successful bodies are cached at the
edge for an hour, and an interstitial is relayed but never cached — freezing a
block page for an hour would make every retry in that window a lie.

Deploy it from its repository (Cloudflare dashboard → Workers & Pages → Create →
Import a repository), then set its secret:

```bash
npx wrangler secret put PROXY_TOKEN
```

::: warning Secrets create a version, they do not deploy it
Adding a secret — from the dashboard or the CLI — creates a new Worker *version*
and leaves traffic on the old one, so the Worker keeps reporting the secret as
unset. Promote it:

```bash
npx wrangler versions deploy <version-id>@100
```
:::

Confirm where it egresses before wiring anything to it:

```bash
curl -H "Authorization: Bearer $PROXY_TOKEN" https://<worker>.<subdomain>.workers.dev/health
```

## Wire it up

| Variable | Value |
|---|---|
| `ISHARES_PROXY_BASE` | The relay's origin, no trailing slash |
| `ISHARES_PROXY_TOKEN` | The shared secret |

Both are required. One without the other stays direct, deliberately: a base with
no token would fail every request with the relay's own `401`, which is a worse
failure than the direct one it replaces.

Then re-probe. The header line is the acceptance test:

```
ishares (IGLB): all steps returned data [proxy https://<worker>.<subdomain>.workers.dev]
```

## What a relay can and cannot fix

Worth reading before spending an afternoon on it, because it decides whether
this approach applies to your block at all:

| Block dimension | Does a Cloudflare Worker help? |
|---|---|
| Egress IP reputation | **Yes** — this is the case it solves. The request now comes from Cloudflare's address, not yours. |
| Egress geography | It changes, but you do not choose it. A Worker runs in the colo nearest its caller, so a host and its Worker usually sit in the same country. |
| TLS/HTTP2 fingerprint (JA3/JA4) | **No.** Subrequests use Cloudflare's TLS stack; no header makes it look like Chrome. |

If a relayed request is still refused, the block is not on your address, and the
next options are a VPS running `curl-impersonate`, or running the ingest from a
hosted CI runner in another region.

## Latency

A relay is a second hop, so it is fair to ask what it costs. Measured against
the product screener — 1.9 MB, the largest thing the ingest fetches — from a
host that can reach iShares both ways:

| Path | Time to first byte |
|---|---|
| Direct, warm in iShares' own CDN cache | 0.04s |
| Direct, cold in iShares' own CDN cache | 1.46–1.52s |
| Via the relay, cold in iShares' cache | 1.51–2.15s |
| Via the relay, warm in the relay's cache | 0.05s |

The relay costs tens to a few hundred milliseconds. What dominates is whether
**iShares'** edge has the response — a cold entry there costs a second and a
half whichever route you take.

Beware of measuring this the way it was first measured here: adding a cache-
busting parameter to force a miss in the relay forces one at Akamai too, which
times a cold origin fetch against a warm CDN hit and blames the relay for the
difference. Compare the same URL both ways.

## An ingest run is slow for its own reasons

If a run feels slow after enabling the relay, suspect the run rather than the
hop. A provider failing at the universe step did no work at all — it gave up in
under a second and cached nothing. Once it succeeds the job walks the entire
lineup: a holdings request per fund, each a distinct URL that may be cold at
iShares' edge, plus the client's 500 ms inter-request throttle, then the shared
Yahoo enrichment and exposure steps. Hundreds of funds at a second or two each
is tens of minutes, and that is the job finally running.

What actually helps:

- `--limit` bounds a first run so you can watch it finish.
- `--scope=equity` skips the bond lineup, whose positions carry no ticker and
  are dropped by the symbol-keyed pipeline anyway.
- Freshness watermarks mean a repeat run re-fetches only what has aged out, so
  the second run is far cheaper than the first.
- A retry inside the cache window is *faster than direct*: the relay answers
  from its own edge cache in ~0.05s, where a direct re-fetch pays iShares'
  latency again.

## Telling the relay's failures from Akamai's

The relay marks its own responses with an `x-proxy-error` header, which iShares
never sends. A refusal carrying it is reported as the relay refusing:

```
iShares proxy refused the request (401) — check ISHARES_PROXY_TOKEN and the proxy's host allowlist
```

An iShares `403` still reports as `iShares request failed (403)`. The difference
is the difference between rotating a token and chasing bot protection.

## Why this is per-provider

The other upstreams — Eastmoney, SEC EDGAR, Yahoo, CoinGecko — are typically
reachable from the same host that iShares refuses, so sending them through a
relay would add a dependency and a hop for nothing. A process-wide `HTTP_PROXY`
(or Node's `NODE_USE_ENV_PROXY`) would need a `NO_PROXY` list covering every
upstream that already works, and would have to be revisited every time one is
added. Two variables read inside one provider's client are the smaller change:
nothing in the pipeline knows the relay exists.
