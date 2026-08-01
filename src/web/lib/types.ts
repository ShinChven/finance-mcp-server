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

export interface Overview {
  activeTokens: number;
  expiringSoon: number;
  activeGrants: number;
  lastMcpAccess: string | null;
  recentActivity: Omit<ActivityItem, "ip">[];
}
