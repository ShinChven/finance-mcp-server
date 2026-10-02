/**
 * Headlines for one symbol, the way the `companyNews` tool reads them.
 *
 * Thumbnails are dropped: they are the bulk of the payload, and the dashboard's
 * content policy would refuse to load them from Yahoo's image host anyway.
 * Only http(s) links survive — a headline is rendered as an anchor, and an
 * upstream that ever sent a `javascript:` URL must not get one onto the page.
 */

import type { NewsArticle } from "../../shared/symbol.js";
import { isoInstant, records, str } from "./read.js";

function safeLink(value: unknown): string | null {
  const link = str(value);
  if (link === null) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function buildNews(result: unknown, limit = 20): NewsArticle[] {
  const news = records((result as { news?: unknown } | null)?.news);
  const seen = new Set<string>();
  const out: NewsArticle[] = [];
  for (const item of news) {
    const link = safeLink(item["link"]);
    const title = str(item["title"]);
    const publishedAt = isoInstant(item["providerPublishTime"]);
    if (link === null || title === null || publishedAt === null) continue;
    const id = str(item["uuid"]) ?? link;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title,
      publisher: str(item["publisher"]),
      link,
      publishedAt,
      relatedTickers: Array.isArray(item["relatedTickers"])
        ? item["relatedTickers"].filter((ticker): ticker is string => typeof ticker === "string")
        : [],
    });
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
}
