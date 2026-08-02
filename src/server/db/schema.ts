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
import type { UserPreferences } from "../../shared/preferences.js";

export const userRole = pgEnum("user_role", ["admin", "user"]);
export const userStatus = pgEnum("user_status", ["active", "disabled"]);
export const tokenStatus = pgEnum("token_status", ["active", "disabled", "revoked"]);
export const clientStatus = pgEnum("client_status", ["active", "disabled"]);
export const grantStatus = pgEnum("grant_status", ["active", "disabled", "revoked"]);
export const oauthTokenKind = pgEnum("oauth_token_kind", ["access", "refresh"]);

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
    // 6-digit China fund code (场外 or 场内 primary code).
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    fundType: text("fund_type"),
    isQdii: boolean("is_qdii").notNull().default(false),
    isIndexFund: boolean("is_index_fund").notNull().default(false),
    trackingIndex: text("tracking_index"),
    trackingIndexCode: text("tracking_index_code"),
    company: text("company"),
    manager: text("manager"),
    feeRate: doublePrecision("fee_rate"),
    fundSize: doublePrecision("fund_size"),
    currency: text("currency").notNull().default("CNY"),
    // Exchange-traded share class, when one exists (`510300.SS`).
    listedSymbol: text("listed_symbol"),
    purchaseStatus: text("purchase_status"),
    purchaseLimit: doublePrecision("purchase_limit"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("funds_qdii_idx").on(t.isQdii),
    index("funds_tracking_index_idx").on(t.trackingIndexCode),
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

export const indexConstituents = pgTable(
  "index_constituents",
  {
    indexCode: text("index_code").notNull(),
    symbol: text("symbol").notNull(),
    weight: doublePrecision("weight"),
    asOf: date("as_of").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("index_constituents_unique_idx").on(t.indexCode, t.symbol, t.asOf),
    index("index_constituents_symbol_idx").on(t.symbol),
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

export type Instrument = typeof instruments.$inferSelect;
export type InstrumentSector = typeof instrumentSectors.$inferSelect;
export type Fund = typeof funds.$inferSelect;
export type FundHolding = typeof fundHoldings.$inferSelect;
export type IndexConstituent = typeof indexConstituents.$inferSelect;
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
