import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { HoldingsCompleteness, ProviderId } from "../../shared/funds.js";
import type { UserPreferences } from "../../shared/preferences.js";
import { WATCHLIST_ITEM_KINDS } from "../../shared/watchlist.js";

export const userRole = pgEnum("user_role", ["admin", "user"]);
export const userStatus = pgEnum("user_status", ["active", "disabled"]);
export const tokenStatus = pgEnum("token_status", ["active", "disabled", "revoked"]);
export const clientStatus = pgEnum("client_status", ["active", "disabled"]);
export const grantStatus = pgEnum("grant_status", ["active", "disabled", "revoked"]);
export const oauthTokenKind = pgEnum("oauth_token_kind", ["access", "refresh"]);
export const ingestJobStatus = pgEnum("ingest_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
// Provider ids, scope ids and holdings completeness are deliberately stored as
// plain text rather than pg enums: their vocabulary is defined in
// `shared/funds.ts` and grows whenever a provider is added, and an enum would
// turn each addition into a migration that has to run before the code that
// needs it. Drizzle's `$type<>()` keeps the compile-time check either way.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    googleSub: text("google_sub"),
    name: text("name"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    role: userRole("role").notNull().default("user"),
    status: userStatus("status").notNull().default("active"),
    preferences: jsonb("preferences").$type<UserPreferences>().notNull().default({}),
    createdAt: createdAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email), uniqueIndex("users_google_sub_idx").on(t.googleSub)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 hash of the cookie value; the raw session id never touches the DB.
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accessTokens = pgTable(
  "access_tokens",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    status: tokenStatus("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastUsedIp: text("last_used_ip"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("access_tokens_hash_idx").on(t.tokenHash),
    index("access_tokens_user_id_idx").on(t.userId),
  ],
);

export const oauthClients = pgTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientName: text("client_name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  logoUri: text("logo_uri"),
  clientUri: text("client_uri"),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull().default("none"),
  status: clientStatus("status").notNull().default("active"),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    status: grantStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("oauth_grants_user_client_idx").on(t.userId, t.clientId),
    index("oauth_grants_user_id_idx").on(t.userId),
  ],
);

export const oauthAuthCodes = pgTable("oauth_auth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  grantId: text("grant_id")
    .notNull()
    .references(() => oauthGrants.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope").notNull(),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  // Token family issued when this code was exchanged; revoked if the code is replayed.
  issuedFamilyId: text("issued_family_id"),
  createdAt: createdAt(),
});

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: id(),
    kind: oauthTokenKind("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    grantId: text("grant_id")
      .notNull()
      .references(() => oauthGrants.id, { onDelete: "cascade" }),
    // Refresh-token rotation family; reuse of a revoked refresh token revokes the family.
    familyId: text("family_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("oauth_tokens_hash_idx").on(t.tokenHash),
    index("oauth_tokens_grant_id_idx").on(t.grantId),
    index("oauth_tokens_family_id_idx").on(t.familyId),
  ],
);

export const watchlistItemKind = pgEnum("watchlist_item_kind", WATCHLIST_ITEM_KINDS);

export const chatRole = pgEnum("chat_role", ["user", "assistant"]);

export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("chat_conversations_user_idx").on(t.userId, t.updatedAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    role: chatRole("role").notNull(),
    content: text("content").notNull(),
    // Model that produced an assistant message (may differ across the conversation).
    model: text("model"),
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/* ------------------------------------------------------------------ *
 * Watchlists
 *
 * A user's own curated lists, readable and editable from both the dashboard
 * and the MCP tools, so an agent and a person work on the same rows. Items
 * carry no market data — prices are fetched live and NAV comes from the fund
 * cache, because a stored price is wrong the moment it is written.
 * ------------------------------------------------------------------ */

export const watchlists = pgTable(
  "watchlists",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Case-insensitive, because MCP callers address lists by name: allowing
    // both "Tech" and "tech" would make `watchlistAdd({ name: "tech" })`
    // ambiguous.
    uniqueIndex("watchlists_user_name_idx").on(t.userId, sql`lower(${t.name})`),
    index("watchlists_user_updated_idx").on(t.userId, t.updatedAt),
  ],
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: id(),
    watchlistId: text("watchlist_id")
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade" }),
    kind: watchlistItemKind("kind").notNull(),
    /** Yahoo symbol (`AAPL`, `0700.HK`) or 6-digit China fund code. */
    ref: text("ref").notNull(),
    name: text("name"),
    /** Why this is being tracked — the context an agent otherwise loses. */
    note: text("note"),
    targetPrice: doublePrecision("target_price"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("watchlist_items_unique_idx").on(t.watchlistId, t.kind, t.ref),
    index("watchlist_items_list_idx").on(t.watchlistId, t.createdAt),
  ],
);

export type Watchlist = typeof watchlists.$inferSelect;
export type WatchlistItem = typeof watchlistItems.$inferSelect;

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: jsonb("meta"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_created_at_idx").on(t.createdAt), index("audit_log_actor_idx").on(t.actorUserId)],
);

/* ------------------------------------------------------------------ *
 * Fund relationship layer
 *
 * These tables answer "which fund gives me exposure to X" without full-text
 * search: holdings and index membership are ingested offline, and the derived
 * `fund_exposure` table is what the MCP tools actually read.
 *
 * One set of tables serves every market. Only `funds` knows which provider a
 * row came from; holdings, NAV and exposure are keyed by fund code alone, so a
 * reverse lookup on a symbol crosses providers in a single index scan instead
 * of having to union per-market tables. That is the whole point — NVDA is held
 * by both a QDII fund and a US ETF, and the interesting answer contains both.
 * ------------------------------------------------------------------ */

/** Canonical symbol format is Yahoo-style so US and CN legs share one key space
 *  (`600519.SS`, `0700.HK`, `AAPL`). */
export const instruments = pgTable(
  "instruments",
  {
    symbol: text("symbol").primaryKey(),
    name: text("name"),
    market: text("market").notNull(),
    type: text("type").notNull().default("stock"),
    currency: text("currency"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("instruments_market_idx").on(t.market)],
);

/** One row per (symbol, taxonomy): `sw` for Shenwan/Eastmoney boards on the CN
 *  side, `gics` for the Yahoo sector on the US/global side. */
export const instrumentSectors = pgTable(
  "instrument_sectors",
  {
    symbol: text("symbol").notNull(),
    taxonomy: text("taxonomy").notNull(),
    sectorCode: text("sector_code").notNull(),
    sectorName: text("sector_name"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("instrument_sectors_symbol_taxonomy_idx").on(t.symbol, t.taxonomy),
    index("instrument_sectors_lookup_idx").on(t.taxonomy, t.sectorCode),
  ],
);

export const funds = pgTable(
  "funds",
  {
    /**
     * Globally unique across providers, and the only identifier anything
     * outside this table uses: a 6-digit code for China (`162411`), the listing
     * ticker elsewhere (`IVV`). Those key spaces cannot collide, which is what
     * lets holdings, NAV and exposure keep single-column foreign keys and lets
     * `watchlist_items.ref` — a loose reference, by design, so an uncached fund
     * can still be watched — stay unambiguous.
     */
    code: text("code").primaryKey(),
    provider: text("provider").$type<ProviderId>().notNull(),
    /** Where the fund itself is domiciled and traded — not where it invests. */
    market: text("market").notNull(),
    name: text("name").notNull(),
    fundType: text("fund_type"),
    /**
     * The fund's mandate points outside its own market: China's QDII wrapper, a
     * US ex-US or emerging-markets ETF. Generalizing QDII rather than keeping it
     * is what makes "a fund I can buy here that holds NVDA" one query instead of
     * one per market.
     */
    investsOffshore: boolean("invests_offshore").notNull().default(false),
    isIndexFund: boolean("is_index_fund").notNull().default(false),
    trackingIndex: text("tracking_index"),
    company: text("company"),
    manager: text("manager"),
    feeRate: doublePrecision("fee_rate"),
    fundSize: doublePrecision("fund_size"),
    currency: text("currency").notNull(),
    // Exchange-traded share class, when one exists (`510300.SS`).
    listedSymbol: text("listed_symbol"),
    /**
     * What this fund's disclosed weights are denominated in. Defaulted from the
     * provider, but stored per fund because it is a property of the report that
     * landed: a China annual report is a complete book where the quarterly one
     * before it was a top-ten slice.
     */
    holdingsCompleteness: text("holdings_completeness")
      .$type<HoldingsCompleteness>()
      .notNull()
      .default("top_holdings"),
    /**
     * Attributes only one provider has, kept out of the shared columns so a
     * China-only field never has to be null on every US ETF row. Nothing joins
     * or filters on these — the moment something needs to, it has earned a
     * column.
     */
    providerMeta: jsonb("provider_meta").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    // Per-step watermarks. A re-run skips whatever is still inside its freshness
    // window, which is what turns a 3-hour full sync into a short incremental
    // one. The three steps age at different rates — holdings are quarterly,
    // NAV is daily, the profile barely changes — so they are tracked apart.
    detailsSyncedAt: timestamp("details_synced_at", { withTimezone: true }),
    holdingsSyncedAt: timestamp("holdings_synced_at", { withTimezone: true }),
    navSyncedAt: timestamp("nav_synced_at", { withTimezone: true }),
    /** Last failure for this fund, cleared on the next success. */
    lastSyncError: text("last_sync_error"),
  },
  (t) => [
    index("funds_offshore_idx").on(t.investsOffshore),
    index("funds_tracking_index_idx").on(t.trackingIndex),
    // Every sync scopes by provider, and the dashboard's market filter is the
    // other half of the same scan.
    index("funds_provider_idx").on(t.provider, t.holdingsSyncedAt),
    index("funds_market_idx").on(t.market),
    // Drives both the "what still needs fetching" scan and the /funds listing's
    // default "recently cached first" order.
    index("funds_holdings_synced_idx").on(t.holdingsSyncedAt),
  ],
);

export const fundHoldings = pgTable(
  "fund_holdings",
  {
    fundCode: text("fund_code")
      .notNull()
      .references(() => funds.code, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    name: text("name"),
    // Percent of net asset value, 0-100.
    weight: doublePrecision("weight").notNull(),
    reportDate: date("report_date").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("fund_holdings_unique_idx").on(t.fundCode, t.symbol, t.reportDate),
    // Reverse index: "which funds hold this stock" is a single index scan.
    index("fund_holdings_symbol_idx").on(t.symbol, t.weight),
    index("fund_holdings_fund_report_idx").on(t.fundCode, t.reportDate),
  ],
);

export const fundNav = pgTable(
  "fund_nav",
  {
    fundCode: text("fund_code")
      .notNull()
      .references(() => funds.code, { onDelete: "cascade" }),
    navDate: date("nav_date").notNull(),
    nav: doublePrecision("nav"),
    accNav: doublePrecision("acc_nav"),
    dailyReturn: doublePrecision("daily_return"),
  },
  (t) => [uniqueIndex("fund_nav_unique_idx").on(t.fundCode, t.navDate)],
);

/** Derived from holdings × instrument metadata. `dimension` is `sector` or
 *  `market`; `coverage` records how much of the fund's disclosed weight could
 *  actually be classified, so callers can tell a real 5% from an unmapped one. */
export const fundExposure = pgTable(
  "fund_exposure",
  {
    fundCode: text("fund_code")
      .notNull()
      .references(() => funds.code, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    taxonomy: text("taxonomy").notNull().default(""),
    key: text("key").notNull(),
    label: text("label"),
    weight: doublePrecision("weight").notNull(),
    coverage: doublePrecision("coverage").notNull(),
    reportDate: date("report_date"),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("fund_exposure_unique_idx").on(t.fundCode, t.dimension, t.taxonomy, t.key),
    // Forward index: "which funds are heaviest in this sector".
    index("fund_exposure_lookup_idx").on(t.dimension, t.taxonomy, t.key, t.weight),
  ],
);

/**
 * One row per sync run, so a job that takes hours is inspectable while it is
 * still going rather than only via whatever the CLI printed at the end.
 *
 * `processedFunds`/`totalFunds` are updated as the run walks the fund list;
 * `summary` holds the final `IngestSummary`.
 */
export const ingestJobs = pgTable(
  "ingest_jobs",
  {
    id: id(),
    provider: text("provider").$type<ProviderId>().notNull(),
    /** One of the provider's own scope ids; `codes` for an explicit list. */
    scope: text("scope").notNull(),
    status: ingestJobStatus("status").notNull().default("queued"),
    /** Null for runs started by the CLI rather than a dashboard user. */
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    /** Explicit fund codes, when `scope` is `codes`. */
    codes: jsonb("codes").$type<string[]>(),
    /** Cap on funds fetched in this run. Null means the run was uncapped. */
    fundLimit: doublePrecision("fund_limit"),
    /** Recorded so a run orphaned by a restart can be resumed as it was asked
     *  for: resuming a force run without this would re-apply the freshness
     *  windows the user explicitly chose to ignore. */
    force: boolean("force").notNull().default(false),
    /** Funds skipped because their watermark was still inside the window. */
    skippedFresh: doublePrecision("skipped_fresh").notNull().default(0),
    totalFunds: doublePrecision("total_funds").notNull().default(0),
    processedFunds: doublePrecision("processed_funds").notNull().default(0),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("ingest_jobs_status_idx").on(t.status),
    index("ingest_jobs_created_idx").on(t.createdAt),
    index("ingest_jobs_provider_idx").on(t.provider, t.createdAt),
  ],
);

export type IngestJob = typeof ingestJobs.$inferSelect;
export type Instrument = typeof instruments.$inferSelect;
export type InstrumentSector = typeof instrumentSectors.$inferSelect;
export type Fund = typeof funds.$inferSelect;
export type FundHolding = typeof fundHoldings.$inferSelect;
export type FundNavRow = typeof fundNav.$inferSelect;
export type FundExposureRow = typeof fundExposure.$inferSelect;

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AccessToken = typeof accessTokens.$inferSelect;
export type OAuthClient = typeof oauthClients.$inferSelect;
export type OAuthGrant = typeof oauthGrants.$inferSelect;
export type OAuthAuthCode = typeof oauthAuthCodes.$inferSelect;
export type OAuthToken = typeof oauthTokens.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
