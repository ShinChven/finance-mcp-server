/**
 * Headlines about this symbol, newest first.
 *
 * Links open in a new tab and carry no referrer: the reader is leaving for a
 * publisher's site and the dashboard's URL — which names what they are
 * researching — is none of that site's business.
 */

import { ExternalLink } from "lucide-react";
import type { NewsArticle } from "../../../shared/symbol.js";
import { formatRelative } from "../../lib/format.js";
import { useNews } from "../../lib/symbol-queries.js";
import { Empty, Loading, Section, Unavailable } from "./parts.js";

export function NewsList({ articles, compact = false }: { articles: NewsArticle[]; compact?: boolean }) {
  if (articles.length === 0) return <Empty>No recent headlines.</Empty>;
  return (
    <ul className={`flex flex-col ${compact ? "gap-2" : "divide-y divide-zinc-100 dark:divide-zinc-800"}`}>
      {articles.map((article) => (
        <li key={article.id} className={compact ? "" : "py-3"}>
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="group block"
          >
            <span className={`${compact ? "text-sm" : "text-[15px]"} font-medium group-hover:text-indigo-600 group-hover:underline dark:group-hover:text-indigo-400`}>
              {article.title}
              <ExternalLink className="ml-1 inline size-3 align-baseline text-zinc-400" aria-hidden="true" />
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              {[article.publisher, formatRelative(article.publishedAt)].filter(Boolean).join(" · ")}
              {!compact && article.relatedTickers.length > 0 && (
                <span className="text-zinc-400"> · {article.relatedTickers.slice(0, 6).join(", ")}</span>
              )}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function NewsTab({ symbol }: { symbol: string }) {
  const news = useNews(symbol);
  return (
    <Section title="News">
      {news.isPending ? (
        <Loading />
      ) : news.isError ? (
        <Unavailable error={news.error} what="News is" />
      ) : (
        <NewsList articles={news.data?.articles ?? []} />
      )}
    </Section>
  );
}
