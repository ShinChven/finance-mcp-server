/**
 * Where else a listing can be looked at: the external platform links.
 *
 * Pure, like the rest of `shared/` — a listing in, URLs out, no fetching and
 * no upstream calls. The dashboard is a reading tool, not a trading one, so the
 * last step of looking at a symbol is usually leaving for the place that can
 * act on it. That hand-off is one function per platform of a symbol we already
 * hold, which is why this file exists instead of a stored link per instrument.
 *
 * The decision is made from `market` and the symbol's suffix, never from
 * `exchange`: that field carries Yahoo's *display* name (`NasdaqGS`, `HKSE`),
 * which is free to change wording, while `0700.HK` is the address itself. A
 * platform that cannot express a listing returns null and simply is not
 * offered — Interactive Brokers is absent for exactly this reason, since it
 * addresses contracts by numeric `conid` and publishes no ticker URL.
 *
 * Every template here was confirmed against the live site, because a quote
 * link that lands on a search box is worse than no link at all.
 */

export const PLATFORM_IDS = ["yahoo", "tradingview", "moomoo", "futu", "xueqiu", "eastmoney"] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

/** The part of a `SymbolIdentity` a link is built from. */
export interface PlatformListing {
  symbol: string;
  /** Yahoo's quote type: `EQUITY`, `ETF`, `INDEX`, `CRYPTOCURRENCY`, … */
  quoteType: string | null;
  /** Yahoo's market bucket: `us_market`, `hk_market`, `cn_market`, … */
  market: string | null;
  /** Yahoo's `fullExchangeName`, used only to pick TradingView's prefix. */
  exchange: string | null;
}

/**
 * The venues a platform other than Yahoo can be addressed in.
 *
 * Deliberately four. Yahoo quotes Tokyo, London and São Paulo too, and every
 * platform below lists some of them under a code this file would have to guess
 * at; a link built on a guess is the failure mode worth avoiding, so an
 * unrecognised listing keeps the one link that is certain.
 */
type Venue = "us" | "hk" | "sh" | "sz";

/** Only these trade as ordinary listings on the broker platforms. */
const LINKABLE_TYPES = new Set(["EQUITY", "ETF"]);

/**
 * Which venue a listing is in, or null when no platform below can address it.
 *
 * `market` does the gating rather than the suffix, because a suffixless symbol
 * is not evidence of a US listing: `BTC-USD` and `GC=F` have no suffix either,
 * and reading them as US tickers is how a crypto pair ends up linking to a
 * stock page that does not exist.
 */
function venueOf({ symbol, quoteType, market }: PlatformListing): Venue | null {
  if (!LINKABLE_TYPES.has((quoteType ?? "").toUpperCase())) return null;
  const suffix = symbol.includes(".") ? symbol.slice(symbol.lastIndexOf(".") + 1).toUpperCase() : "";
  if (market === "us_market" && suffix === "") return "us";
  if (market === "hk_market" && suffix === "HK") return "hk";
  if (market === "cn_market" && suffix === "SS") return "sh";
  if (market === "cn_market" && suffix === "SZ") return "sz";
  return null;
}

/** The part before the suffix: `0700.HK` → `0700`, `AAPL` → `AAPL`. */
function base(symbol: string): string {
  const dot = symbol.lastIndexOf(".");
  return dot === -1 ? symbol : symbol.slice(0, dot);
}

/**
 * A US ticker with its class separator respelled.
 *
 * Yahoo writes Berkshire's B shares `BRK-B`; moomoo and Futu want `BRK.B`,
 * Eastmoney `BRK_B`. One character, and it is the difference between the
 * company's page and a 404.
 */
function usTicker(symbol: string, separator: "." | "_" | "-"): string {
  return symbol.replace(/-/g, separator);
}

/** A Hong Kong code as the Chinese platforms write it: five digits, `0700` → `00700`. */
function hkPadded(symbol: string): string {
  return base(symbol).padStart(5, "0");
}

/** A Hong Kong code as TradingView writes it: unpadded, `0700` → `700`. */
function hkBare(symbol: string): string {
  return base(symbol).replace(/^0+/, "");
}

/**
 * Yahoo's exchange display name → TradingView's exchange prefix.
 *
 * Only the names worth being sure about. Anything else falls back to a bare
 * ticker, which TradingView resolves to its own default listing: a little less
 * precise than a prefix, and much better than `CBOE:` on a guess.
 */
const TRADINGVIEW_US_EXCHANGES: Record<string, string> = {
  nasdaqgs: "NASDAQ",
  nasdaqgm: "NASDAQ",
  nasdaqcm: "NASDAQ",
  nasdaq: "NASDAQ",
  nms: "NASDAQ",
  ngm: "NASDAQ",
  ncm: "NASDAQ",
  nyse: "NYSE",
  nyq: "NYSE",
  nysearca: "AMEX",
  "nyse arca": "AMEX",
  nysemkt: "AMEX",
  "nyse mkt": "AMEX",
  nyseamerican: "AMEX",
  "nyse american": "AMEX",
  amex: "AMEX",
  pcx: "AMEX",
  ase: "AMEX",
};

function tradingviewSymbol(listing: PlatformListing, venue: Venue): string {
  const { symbol, exchange } = listing;
  switch (venue) {
    case "us": {
      const prefix = TRADINGVIEW_US_EXCHANGES[(exchange ?? "").trim().toLowerCase()];
      const ticker = usTicker(symbol, ".");
      return prefix === undefined ? ticker : `${prefix}:${ticker}`;
    }
    case "hk":
      return `HKEX:${hkBare(symbol)}`;
    case "sh":
      return `SSE:${base(symbol)}`;
    case "sz":
      return `SZSE:${base(symbol)}`;
  }
}

/** moomoo and Futu share one path, differing only in host. */
function futuPath(listing: PlatformListing, venue: Venue): string {
  const { symbol } = listing;
  switch (venue) {
    case "us":
      return `${usTicker(symbol, ".")}-US`;
    case "hk":
      return `${hkPadded(symbol)}-HK`;
    case "sh":
      return `${base(symbol)}-SH`;
    case "sz":
      return `${base(symbol)}-SZ`;
  }
}

export interface Platform {
  id: PlatformId;
  label: string;
  /** The listing's page on this platform, or null when it cannot address it. */
  url(listing: PlatformListing): string | null;
}

/** Keyed by id so a caller can offer one platform without filtering the list. */
export const PLATFORMS: Record<PlatformId, Platform> = {
  /**
   * Yahoo is the only platform offered for every listing, because our symbols
   * *are* Yahoo symbols — indices, crypto pairs, futures and foreign listings
   * included. `^` has to be encoded or it reads as a fragment.
   */
  yahoo: {
    id: "yahoo",
    label: "Yahoo Finance",
    url: ({ symbol }) => `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
  },
  tradingview: {
    id: "tradingview",
    label: "TradingView",
    url: (listing) => {
      const venue = venueOf(listing);
      if (venue === null) return null;
      return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tradingviewSymbol(listing, venue))}`;
    },
  },
  moomoo: {
    id: "moomoo",
    label: "moomoo",
    url: (listing) => {
      const venue = venueOf(listing);
      return venue === null ? null : `https://www.moomoo.com/stock/${futuPath(listing, venue)}`;
    },
  },
  futu: {
    id: "futu",
    label: "Futu",
    url: (listing) => {
      const venue = venueOf(listing);
      return venue === null ? null : `https://www.futunn.com/stock/${futuPath(listing, venue)}`;
    },
  },
  xueqiu: {
    id: "xueqiu",
    label: "雪球",
    url: (listing) => {
      const venue = venueOf(listing);
      if (venue === null) return null;
      const { symbol } = listing;
      const code =
        venue === "us"
          ? usTicker(symbol, ".")
          : venue === "hk"
            ? hkPadded(symbol)
            : `${venue.toUpperCase()}${base(symbol)}`;
      return `https://xueqiu.com/S/${code}`;
    },
  },
  eastmoney: {
    id: "eastmoney",
    label: "东方财富",
    url: (listing) => {
      const venue = venueOf(listing);
      if (venue === null) return null;
      const { symbol } = listing;
      switch (venue) {
        case "us":
          return `https://quote.eastmoney.com/us/${usTicker(symbol, "_")}.html`;
        case "hk":
          return `https://quote.eastmoney.com/hk/${hkPadded(symbol)}.html`;
        default:
          return `https://quote.eastmoney.com/${venue}${base(symbol)}.html`;
      }
    },
  },
};

export interface PlatformLink {
  id: PlatformId;
  label: string;
  url: string;
}

/**
 * Every platform that can address this listing, in display order.
 *
 * The order is the list above: the global reference first, then the charting
 * tool, then the brokers, then the Chinese retail sites. A symbol page for an
 * S&P index shows one link and a Shanghai listing shows six, which is the
 * honest answer rather than six links of which four are broken.
 */
export function platformLinksFor(listing: PlatformListing): PlatformLink[] {
  const links: PlatformLink[] = [];
  for (const id of PLATFORM_IDS) {
    const platform = PLATFORMS[id];
    const url = platform.url(listing);
    if (url !== null) links.push({ id, label: platform.label, url });
  }
  return links;
}
