/**
 * Symbol normalization — the one key space every provider writes into.
 *
 * Everything in the relationship tables is keyed by the Yahoo-style symbol the
 * existing Yahoo tools already speak, so a China quarterly report and a US
 * ETF's daily holdings file land on the same row for the same company and a
 * reverse lookup joins them without a translation step at query time.
 */

export type Market = "CN" | "HK" | "US" | "JP" | "DE" | "OTHER";

/**
 * Maps a raw exchange code to a canonical symbol.
 *
 * - 6-digit CN codes gain `.SS` / `.SZ` / `.BJ` from their prefix
 * - 5-digit HK codes collapse to Yahoo's 4-digit `.HK` form (`00700` → `0700.HK`)
 * - 3-digit + letter codes are Tokyo's post-2024 alphanumeric form (`285A` → `285A.T`)
 * - anything already carrying a suffix, or alphabetic (US), passes through
 */
export function toCanonicalSymbol(raw: string): string | undefined {
  const code = raw.trim().toUpperCase();
  if (code === "") return undefined;
  if (code.includes(".")) return code;

  // Checked before the numeric branches: TSE began issuing codes like `285A`
  // (Kioxia) in 2024, and a leading digit would otherwise fall through to the
  // US branch, which requires an alphabetic first character.
  if (/^\d{3}[A-Z]$/.test(code)) return `${code}.T`;

  if (/^\d{6}$/.test(code)) {
    if (/^(60|68|51|56|58|50)/.test(code)) return `${code}.SS`;
    if (/^(00|30|15|16|18|12|39)/.test(code)) return `${code}.SZ`;
    if (/^(4|8)/.test(code)) return `${code}.BJ`;
    // 9xxxxx is a legacy B-share on Shanghai.
    if (code.startsWith("9")) return `${code}.SS`;
    return `${code}.SS`;
  }

  if (/^\d{4,5}$/.test(code)) {
    const padded = code.padStart(5, "0").slice(-4);
    return `${padded}.HK`;
  }

  if (/^[A-Z][A-Z0-9.-]{0,15}$/.test(code)) return code;

  return undefined;
}

export function marketOf(symbol: string): Market {
  const upper = symbol.trim().toUpperCase();
  if (/\.(SS|SZ|BJ)$/.test(upper)) return "CN";
  if (upper.endsWith(".HK")) return "HK";
  if (upper.endsWith(".T")) return "JP";
  if (upper.endsWith(".DE")) return "DE";
  if (upper.includes(".")) return "OTHER";
  return "US";
}

export function currencyOf(market: Market): string {
  switch (market) {
    case "CN":
      return "CNY";
    case "HK":
      return "HKD";
    case "US":
      return "USD";
    case "JP":
      return "JPY";
    case "DE":
      return "EUR";
    default:
      return "USD";
  }
}
