import {
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

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AccessToken = typeof accessTokens.$inferSelect;
export type OAuthClient = typeof oauthClients.$inferSelect;
export type OAuthGrant = typeof oauthGrants.$inferSelect;
export type OAuthAuthCode = typeof oauthAuthCodes.$inferSelect;
export type OAuthToken = typeof oauthTokens.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
