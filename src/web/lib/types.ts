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

export type IngestScope = "qdii" | "index" | "equity" | "all" | "codes";

export interface FundItem {
  code: string;
  name: string;
  fundType: string | null;
  isQdii: boolean;
  isIndexFund: boolean;
  trackingIndex: string | null;
  company: string | null;
  fundSize: number | null;
  feeRate: number | null;
  detailsSyncedAt: string | null;
  holdingsSyncedAt: string | null;
  navSyncedAt: string | null;
  lastSyncError: string | null;
  holdingsCount: number;
}

export interface FundCacheStats {
  funds: { total: number; cached: number; failing: number };
  holdings: { rows: number; symbols: number; latestReport: string | null };
  byScope: Record<string, { total: number; cached: number }>;
  activeJobId: string | null;
}

export interface HoldingRow {
  symbol: string;
  name: string | null;
  weight: number;
  reportDate: string;
}

export interface FundHoldingsResult {
  fund: {
    code: string;
    name: string;
    fundType: string | null;
    company: string | null;
    trackingIndex: string | null;
    holdingsSyncedAt: string | null;
    lastSyncError: string | null;
  };
  latestReport: string | null;
  disclosedWeight: number;
  items: HoldingRow[];
  reportDates: string[];
}

/** The counts shown before a sync is confirmed. */
export interface SyncPreview {
  scope: IngestScope;
  matched: number;
  fresh: number;
  toFetch: number;
  estimatedRequests: number;
  estimatedMinutes: number;
}

export interface IngestJobItem {
  id: string;
  scope: IngestScope;
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
