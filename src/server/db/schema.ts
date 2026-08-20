import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { HoldingsCompleteness, ProviderId } from "../../shared/funds.js";
import type { UserPreferences } from "../../shared/preferences.js";
import { NOTE_SOURCES, NOTE_STATUSES } from "../../shared/notes.js";
import { SKILL_SOURCES, SKILL_STATUSES } from "../../shared/skills.js";
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

/* ------------------------------------------------------------------ *
 * Notes
 *
 * Long-lived memory for the assistant, and a place a person can read and
 * correct it. The MCP tools write what a conversation established; the Notes
 * page shows the same rows, so nothing an agent stores is invisible to the
 * user who owns it.
 *
 * Three things make a note findable, and they are stored differently on
 * purpose. `summary` is the one-paragraph gist an agent reads while scanning a
 * list — it exists so that finding the right note does not require pulling
 * every body. Tags and symbols are normalized into their own tables because
 * both are filters ("everything tagged rate-cut", "everything about NVDA"), and
 * a filter over a JSON array is a sequential scan. The body is searched by
 * Postgres full text, indexed once as a stored vector rather than recomputed
 * per query.
 * ------------------------------------------------------------------ */

export const noteStatus = pgEnum("note_status", NOTE_STATUSES);
export const noteSource = pgEnum("note_source", NOTE_SOURCES);

/**
 * `tsvector` has no drizzle-native column type; only the DDL and the operators
 * matter, and both are plain SQL.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const noteCollections = pgTable(
  "note_collections",
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
    // Case-insensitive for the same reason watchlists are: MCP callers address
    // a collection by name, and "Macro" vs "macro" would be a coin flip.
    uniqueIndex("note_collections_user_name_idx").on(t.userId, sql`lower(${t.name})`),
    index("note_collections_user_updated_idx").on(t.userId, t.updatedAt),
  ],
);

export const notes = pgTable(
  "notes",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Nullable: an uncollected note is the normal case, not an error. An agent
     * capturing something mid-conversation should not have to invent a filing
     * decision first, and deleting a collection files its notes back here
     * rather than destroying them.
     */
    collectionId: text("collection_id").references(() => noteCollections.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    /**
     * The scannable gist. Listing tools return this and never the body, which
     * is what keeps "find the note about the Fed" one cheap call instead of a
     * download of everything the user ever saved.
     */
    summary: text("summary"),
    body: text("body").notNull().default(""),
    status: noteStatus("status").notNull().default("active"),
    source: noteSource("source").notNull().default("web"),
    /** Free-text provenance — a chat id, a client name, a URL. Not a foreign
     *  key: the conversation an agent captured usually lives in that agent's
     *  own client, not in this database. */
    sourceRef: text("source_ref"),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    /**
     * Stored, not computed per query, and weighted so a title hit outranks a
     * body hit.
     *
     * `simple` rather than `english`: the corpus is mixed Chinese and English,
     * and English stemming buys a little recall on one half while the parser
     * does nothing useful for the other. Stemming is not what makes this
     * feature work — the search path pairs this index with a substring match,
     * which is what actually finds 降息 inside a sentence.
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('simple', coalesce(${notes.title}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${notes.summary}, '')), 'B') || setweight(to_tsvector('simple', coalesce(${notes.body}, '')), 'C')`,
    ),
  },
  (t) => [
    // The default listing: this user's notes, newest first.
    index("notes_user_updated_idx").on(t.userId, t.updatedAt),
    // The same scan with the archived rows excluded, which is what the page and
    // the tools ask for unless told otherwise.
    index("notes_user_status_idx").on(t.userId, t.status, t.updatedAt),
    index("notes_collection_idx").on(t.collectionId, t.updatedAt),
    index("notes_search_idx").using("gin", t.searchVector),
  ],
);

/**
 * Tags, one row per (note, tag).
 *
 * No `user_id` here or on `note_symbols`: ownership is a property of the note,
 * and duplicating it would create a second copy to keep true. Facet counts join
 * back to `notes`, which is cheap against a per-user note cap of a few
 * thousand.
 */
export const noteTags = pgTable(
  "note_tags",
  {
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    /** Already normalized by `shared/notes.ts` — lowercase, hyphenated. */
    tag: text("tag").notNull(),
  },
  (t) => [
    uniqueIndex("note_tags_unique_idx").on(t.noteId, t.tag),
    // Reverse index: "everything tagged X" without touching the notes table
    // until the ids are known.
    index("note_tags_tag_idx").on(t.tag),
  ],
);

/**
 * Instruments a note is about.
 *
 * Deliberately a loose reference rather than a foreign key to `instruments`: a
 * note may be about a symbol this server has never cached, and losing the link
 * because the ingest has not reached it would defeat the point. `kind` is the
 * watchlist's own vocabulary, so one spelling serves both features.
 */
export const noteSymbols = pgTable(
  "note_symbols",
  {
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    kind: watchlistItemKind("kind").notNull(),
    ref: text("ref").notNull(),
  },
  (t) => [
    uniqueIndex("note_symbols_unique_idx").on(t.noteId, t.kind, t.ref),
    // "What do I know about NVDA" is the reverse lookup this exists for.
    index("note_symbols_ref_idx").on(t.ref),
  ],
);

export type NoteCollection = typeof noteCollections.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type NoteTagRow = typeof noteTags.$inferSelect;
export type NoteSymbolRow = typeof noteSymbols.$inferSelect;

/* ------------------------------------------------------------------ *
 * Skills — user-authored procedures, addressed by name.
 *
 * Deliberately not a flag on `notes`. A note is recalled fuzzily out of
 * thousands; a skill is called by a stable name out of a couple of hundred, and
 * its `when_to_use` is not a human summary but the text retrieval matches on.
 * The tables that look alike here would have diverged on the first index.
 * ------------------------------------------------------------------ */

export const skillStatus = pgEnum("skill_status", SKILL_STATUSES);
export const skillSource = pgEnum("skill_source", SKILL_SOURCES);

export const skills = pgTable(
  "skills",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The stable identifier an agent addresses, and what the user types to call
     * the skill. Normalized on write by `shared/skills.ts`, so the unique index
     * below needs no `lower()` wrapper — unlike watchlists and note
     * collections, which preserve the user's own capitalisation.
     */
    slug: text("slug").notNull(),
    /** Human title for the dashboard. The frontmatter-style identity is the
     *  slug; these two are allowed to differ. */
    name: text("name").notNull(),
    /**
     * Retrieval hangs entirely on this line. It is what `skills` search matches
     * and what the agent reads to decide the skill applies, which is why it is
     * `not null` while a note's summary is optional: a skill nobody can find is
     * not a cheaper skill, it is a missing one.
     */
    whenToUse: text("when_to_use").notNull(),
    /** The procedure itself. Returned by `skillRead` and nothing else. */
    body: text("body").notNull().default(""),
    status: skillStatus("status").notNull().default("active"),
    source: skillSource("source").notNull().default("web"),
    /** Free-text provenance — a chat id, a client name. Same contract as
     *  `notes.source_ref`; not a foreign key for the same reason. */
    sourceRef: text("source_ref"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    /**
     * `simple` and weighted, for the reasons spelled out on `notes.search_vector`.
     * Slug and name share the top weight because a near-miss on a name the user
     * half-remembers is the query this index exists to serve; the body ranks
     * last so an incidental mention never outranks the skill actually about it.
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('simple', coalesce(${skills.slug}, '') || ' ' || coalesce(${skills.name}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${skills.whenToUse}, '')), 'B') || setweight(to_tsvector('simple', coalesce(${skills.body}, '')), 'C')`,
    ),
  },
  (t) => [
    // The hot path. `skillRead("fund-screen")` is one index hit — the whole
    // point of addressing skills by name instead of searching for them.
    uniqueIndex("skills_user_slug_idx").on(t.userId, t.slug),
    index("skills_user_status_idx").on(t.userId, t.status, t.updatedAt),
    index("skills_search_idx").using("gin", t.searchVector),
  ],
);

/**
 * What a skill said before the last edit.
 *
 * A skill is executable intent, so "the agent started doing this differently
 * and nobody remembers changing anything" is a question that has to be
 * answerable. One insert per update, bounded by the per-skill trim in the repo.
 */
export const skillRevisions = pgTable(
  "skill_revisions",
  {
    id: id(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    whenToUse: text("when_to_use").notNull(),
    body: text("body").notNull(),
    /** Who produced the version being replaced. */
    source: skillSource("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("skill_revisions_skill_idx").on(t.skillId, t.createdAt)],
);

export type Skill = typeof skills.$inferSelect;
export type SkillRevision = typeof skillRevisions.$inferSelect;

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

/**
 * Every security any cached fund holds, and what is known about it.
 *
 * The primary key is the Yahoo-style canonical symbol (`600519.SS`, `0700.HK`,
 * `AAPL`) — one key space shared by every provider and by the Yahoo tools, which
 * is what lets a China quarterly report and a US ETF's holdings file land on the
 * same row for the same company.
 *
 * The attribute columns are what make a cross-source question answerable in
 * SQL. Sector classification alone could not answer "which funds hold large-cap
 * US names": that needs Yahoo's own view of the instrument sitting next to the
 * holdings, so the enrichment step lands it here rather than throwing away
 * everything but the sector.
 */
export const instruments = pgTable(
  "instruments",
  {
    symbol: text("symbol").primaryKey(),
    /**
     * The identifier that survives what a ticker does not: a venue change, a
     * ticker reassignment, a dual listing. Stored when a source publishes one,
     * and the reliable key for reconciling this instrument against a source
     * that does not speak Yahoo symbols.
     */
    isin: text("isin"),
    name: text("name"),
    market: text("market").notNull(),
    /** Yahoo's `quoteType`, lowercased (`equity`, `etf`, …). */
    type: text("type").notNull().default("stock"),
    currency: text("currency"),
    /** Yahoo's full exchange name, for provenance rather than for joining. */
    exchange: text("exchange"),
    /** Country of domicile per Yahoo `assetProfile` — an ADR's home country,
     *  which is not always what the listing suffix implies. */
    country: text("country"),
    /** Market capitalization in `currency`, as reported. */
    marketCap: doublePrecision("market_cap"),
    /**
     * The same figure converted to USD at enrichment time.
     *
     * Carried explicitly because the native column cannot be compared across
     * markets — filtering "above 10 billion" over a mixed JPY/USD/CNY column
     * silently ranks by currency, not by size.
     */
    marketCapUsd: doublePrecision("market_cap_usd"),
    /** Watermark for the enrichment step. Set even when Yahoo returned nothing
     *  usable, so an uncovered symbol is not refetched on every single run. */
    profileSyncedAt: timestamp("profile_synced_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("instruments_market_idx").on(t.market),
    // Partial: most instruments have no ISIN, and many nulls in a unique index
    // are allowed but pointless to store.
    uniqueIndex("instruments_isin_idx")
      .on(t.isin)
      .where(sql`${t.isin} is not null`),
    // Range filters on size are the point of the column.
    index("instruments_market_cap_idx").on(t.marketCapUsd),
    // Drives the "what still needs enriching" scan.
    index("instruments_profile_synced_idx").on(t.profileSyncedAt),
  ],
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

/**
 * When each provider's fund index was last downloaded.
 *
 * The index is refreshed on its own schedule, independently of any category
 * sync, so this watermark cannot live on `funds` — it has to survive being
 * asked before a single fund row exists, which is precisely the state it
 * exists to get the server out of.
 */
export const fundIndexState = pgTable("fund_index_state", {
  provider: text("provider").$type<ProviderId>().primaryKey(),
  /** Funds the provider published at that moment. */
  fundCount: integer("fund_count").notNull().default(0),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  /** Last listing failure, cleared on the next success. */
  lastError: text("last_error"),
});

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
export type FundIndexState = typeof fundIndexState.$inferSelect;
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
