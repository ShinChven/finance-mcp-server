import type { HoldingsCompleteness, ProviderId } from "../../shared/funds.js";
import type { NoteSource, NoteStatus } from "../../shared/notes.js";
import type { SkillSource, SkillStatus } from "../../shared/skills.js";
import type { WatchlistItemKind } from "../../shared/watchlist.js";

import type { JsonSchemaNode } from "./json-schema.js";
import type { UserPreferences } from "../../shared/preferences.js";

export interface Me {
  id: string;
  email: string;
  name: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: "admin" | "user";
  status: "active" | "disabled";
  preferences: UserPreferences;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface TokenItem {
  id: string;
  name: string;
  tokenPrefix: string;
  status: "active" | "disabled" | "revoked";
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  createdAt: string;
}

export interface GrantItem {
  id: string;
  clientId: string;
  clientName: string;
  clientUri: string | null;
  logoUri: string | null;
  clientStatus: "active" | "disabled";
  scope: string;
  status: "active" | "disabled" | "revoked";
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AdminClientItem {
  clientId: string;
  clientName: string;
  clientUri: string | null;
  logoUri: string | null;
  redirectUris: string[];
  status: "active" | "disabled";
  grantCount: number;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AuditItem {
  id: string;
  action: string;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface SessionItem {
  id: string;
  createdAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

/** A tool as returned by MCP `tools/list`, mirrored 1:1 by `GET /api/tools`. */
export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  inputSchema: JsonSchemaNode;
  outputSchema?: JsonSchemaNode;
}

export interface ToolCatalog {
  server: { name: string; version: string; instructions: string | null };
  items: McpToolInfo[];
  total: number;
}

export interface FundItem {
  code: string;
  provider: ProviderId;
  /** Where the fund trades, not where it invests. */
  market: string;
  currency: string;
  name: string;
  fundType: string | null;
  investsOffshore: boolean;
  isIndexFund: boolean;
  trackingIndex: string | null;
  company: string | null;
  /** Net assets in millions of `currency`. */
  fundSize: number | null;
  feeRate: number | null;
  holdingsCompleteness: HoldingsCompleteness;
  detailsSyncedAt: string | null;
  holdingsSyncedAt: string | null;
  navSyncedAt: string | null;
  lastSyncError: string | null;
  holdingsCount: number;
}

/** Coverage for one provider, with a breakdown by its own scopes. */
export interface ProviderStats {
  id: ProviderId;
  label: string;
  domicile: string;
  completeness: HoldingsCompleteness;
  total: number;
  cached: number;
  failing: number;
  byScope: Record<string, { total: number; cached: number }>;
}

export interface FundCacheStats {
  funds: { total: number; cached: number; failing: number };
  holdings: { rows: number; symbols: number; latestReport: string | null };
  providers: ProviderStats[];
  activeJobId: string | null;
}

export interface HoldingRow {
  symbol: string;
  name: string | null;
  weight: number;
  reportDate: string;
  /** From the enriched instrument row; null until the Yahoo join reaches it. */
  isin: string | null;
  country: string | null;
  marketCapUsd: number | null;
  profileSyncedAt: string | null;
}

export interface FundHoldingsResult {
  fund: {
    code: string;
    provider: ProviderId;
    market: string;
    currency: string;
    name: string;
    fundType: string | null;
    company: string | null;
    trackingIndex: string | null;
    holdingsCompleteness: HoldingsCompleteness;
    holdingsSyncedAt: string | null;
    lastSyncError: string | null;
  };
  latestReport: string | null;
  disclosedWeight: number;
  /** Positions the Yahoo enrichment has reached, of `items.length`. */
  enrichedPositions: number;
  items: HoldingRow[];
  reportDates: string[];
}

/** The counts shown before a sync is confirmed. */
export interface SyncPreview {
  provider: ProviderId;
  scope: string;
  matched: number;
  fresh: number;
  toFetch: number;
  estimatedRequests: number;
  estimatedMinutes: number;
}

export interface IngestJobItem {
  id: string;
  provider: ProviderId;
  scope: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  requestedBy: string | null;
  codes: string[] | null;
  fundLimit: number | null;
  skippedFresh: number;
  totalFunds: number;
  processedFunds: number;
  summary: {
    fundsUpserted?: number;
    fundDetailsUpserted?: number;
    holdingsUpserted?: number;
    navPointsUpserted?: number;
    symbolsClassified?: number;
    exposuresComputed?: number;
    skippedFresh?: number;
    holdingsDropped?: number;
    errors?: string[];
  } | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface JobsResult {
  items: IngestJobItem[];
  activeJobId: string | null;
}

export interface Overview {
  activeTokens: number;
  expiringSoon: number;
  activeGrants: number;
  lastMcpAccess: string | null;
  recentActivity: Omit<ActivityItem, "ip">[];
}

/* ---------------------------------------------------------------- *
 * Watchlists
 * ---------------------------------------------------------------- */

export interface WatchlistSummary {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

/** What an item is currently worth, and where that number came from. */
export interface LiveValue {
  /** `market` is an intraday quote; `nav` is a fund's last published NAV. */
  basis: "market" | "nav";
  price: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string | null;
  marketState: string | null;
  asOf: string | null;
  available: boolean;
  unavailableReason?: string;
}

export interface WatchlistItem {
  id: string;
  kind: WatchlistItemKind;
  ref: string;
  name: string | null;
  note: string | null;
  targetPrice: number | null;
  targetDistancePercent: number | null;
  addedAt: string;
  live: LiveValue;
}

export interface WatchlistTotals {
  items: number;
  priced: number;
  advancing: number;
  declining: number;
  averageChangePercent: number | null;
  best: { ref: string; changePercent: number } | null;
  worst: { ref: string; changePercent: number } | null;
}

export interface WatchlistItemsResult {
  watchlist: WatchlistSummary;
  total: number;
  items: WatchlistItem[];
  summary: WatchlistTotals | null;
}

export interface AddItemsResult {
  added: { id: string; ref: string }[];
  skipped: string[];
}

/* ---------------------------------------------------------------- *
 * Notes
 * ---------------------------------------------------------------- */

export interface NoteCollection {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteSymbol {
  kind: WatchlistItemKind;
  ref: string;
}

/** A note as a listing sees it: summary and snippet, never the body. */
export interface NoteCard {
  id: string;
  title: string;
  summary: string | null;
  collectionId: string | null;
  collectionName: string | null;
  tags: string[];
  symbols: NoteSymbol[];
  status: NoteStatus;
  source: NoteSource;
  pinned: boolean;
  bodyChars: number;
  snippet: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDetail extends NoteCard {
  body: string;
  sourceRef: string | null;
}

export interface NoteFacets {
  tags: { tag: string; count: number }[];
  symbols: { kind: WatchlistItemKind; ref: string; count: number }[];
}

/* ---------------------------------------------------------------- *
 * Skills
 * ---------------------------------------------------------------- */

/** A skill as a listing sees it: the description, never the procedure. */
export interface SkillCard {
  id: string;
  slug: string;
  name: string;
  whenToUse: string;
  status: SkillStatus;
  source: SkillSource;
  autoDiscover: boolean;
  bodyChars: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillDetail extends SkillCard {
  body: string;
  sourceRef: string | null;
}

export interface SkillRevision {
  id: string;
  name: string;
  whenToUse: string;
  body: string;
  source: SkillSource;
  createdAt: string;
}
