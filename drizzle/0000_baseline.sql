CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."grant_status" AS ENUM('active', 'disabled', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."ingest_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."oauth_token_kind" AS ENUM('access', 'refresh');--> statement-breakpoint
CREATE TYPE "public"."token_status" AS ENUM('active', 'disabled', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."watchlist_item_kind" AS ENUM('symbol', 'fund');--> statement-breakpoint
CREATE TABLE "access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"status" "token_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"meta" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_exposure" (
	"fund_code" text NOT NULL,
	"dimension" text NOT NULL,
	"taxonomy" text DEFAULT '' NOT NULL,
	"key" text NOT NULL,
	"label" text,
	"weight" double precision NOT NULL,
	"coverage" double precision NOT NULL,
	"report_date" date,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_holdings" (
	"fund_code" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text,
	"weight" double precision NOT NULL,
	"report_date" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fund_nav" (
	"fund_code" text NOT NULL,
	"nav_date" date NOT NULL,
	"nav" double precision,
	"acc_nav" double precision,
	"daily_return" double precision
);
--> statement-breakpoint
CREATE TABLE "funds" (
	"code" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"market" text NOT NULL,
	"name" text NOT NULL,
	"fund_type" text,
	"invests_offshore" boolean DEFAULT false NOT NULL,
	"is_index_fund" boolean DEFAULT false NOT NULL,
	"tracking_index" text,
	"company" text,
	"manager" text,
	"fee_rate" double precision,
	"fund_size" double precision,
	"currency" text NOT NULL,
	"listed_symbol" text,
	"holdings_completeness" text DEFAULT 'top_holdings' NOT NULL,
	"provider_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details_synced_at" timestamp with time zone,
	"holdings_synced_at" timestamp with time zone,
	"nav_synced_at" timestamp with time zone,
	"last_sync_error" text
);
--> statement-breakpoint
CREATE TABLE "ingest_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"scope" text NOT NULL,
	"status" "ingest_job_status" DEFAULT 'queued' NOT NULL,
	"requested_by" text,
	"codes" jsonb,
	"fund_limit" double precision,
	"force" boolean DEFAULT false NOT NULL,
	"skipped_fresh" double precision DEFAULT 0 NOT NULL,
	"total_funds" double precision DEFAULT 0 NOT NULL,
	"processed_funds" double precision DEFAULT 0 NOT NULL,
	"summary" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "instrument_sectors" (
	"symbol" text NOT NULL,
	"taxonomy" text NOT NULL,
	"sector_code" text NOT NULL,
	"sector_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text,
	"market" text NOT NULL,
	"type" text DEFAULT 'stock' NOT NULL,
	"currency" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_auth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text NOT NULL,
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"issued_family_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"client_name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"logo_uri" text,
	"client_uri" text,
	"token_endpoint_auth_method" text DEFAULT 'none' NOT NULL,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"scope" text NOT NULL,
	"status" "grant_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "oauth_token_kind" NOT NULL,
	"token_hash" text NOT NULL,
	"grant_id" text NOT NULL,
	"family_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"google_sub" text,
	"name" text,
	"display_name" text,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" text PRIMARY KEY NOT NULL,
	"watchlist_id" text NOT NULL,
	"kind" "watchlist_item_kind" NOT NULL,
	"ref" text NOT NULL,
	"name" text,
	"note" text,
	"target_price" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_exposure" ADD CONSTRAINT "fund_exposure_fund_code_funds_code_fk" FOREIGN KEY ("fund_code") REFERENCES "public"."funds"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_holdings" ADD CONSTRAINT "fund_holdings_fund_code_funds_code_fk" FOREIGN KEY ("fund_code") REFERENCES "public"."funds"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_nav" ADD CONSTRAINT "fund_nav_fund_code_funds_code_fk" FOREIGN KEY ("fund_code") REFERENCES "public"."funds"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_auth_codes" ADD CONSTRAINT "oauth_auth_codes_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_auth_codes" ADD CONSTRAINT "oauth_auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_auth_codes" ADD CONSTRAINT "oauth_auth_codes_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_tokens_hash_idx" ON "access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "access_tokens_user_id_idx" ON "access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "chat_conversations_user_idx" ON "chat_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_idx" ON "chat_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fund_exposure_unique_idx" ON "fund_exposure" USING btree ("fund_code","dimension","taxonomy","key");--> statement-breakpoint
CREATE INDEX "fund_exposure_lookup_idx" ON "fund_exposure" USING btree ("dimension","taxonomy","key","weight");--> statement-breakpoint
CREATE UNIQUE INDEX "fund_holdings_unique_idx" ON "fund_holdings" USING btree ("fund_code","symbol","report_date");--> statement-breakpoint
CREATE INDEX "fund_holdings_symbol_idx" ON "fund_holdings" USING btree ("symbol","weight");--> statement-breakpoint
CREATE INDEX "fund_holdings_fund_report_idx" ON "fund_holdings" USING btree ("fund_code","report_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fund_nav_unique_idx" ON "fund_nav" USING btree ("fund_code","nav_date");--> statement-breakpoint
CREATE INDEX "funds_offshore_idx" ON "funds" USING btree ("invests_offshore");--> statement-breakpoint
CREATE INDEX "funds_tracking_index_idx" ON "funds" USING btree ("tracking_index");--> statement-breakpoint
CREATE INDEX "funds_provider_idx" ON "funds" USING btree ("provider","holdings_synced_at");--> statement-breakpoint
CREATE INDEX "funds_market_idx" ON "funds" USING btree ("market");--> statement-breakpoint
CREATE INDEX "funds_holdings_synced_idx" ON "funds" USING btree ("holdings_synced_at");--> statement-breakpoint
CREATE INDEX "ingest_jobs_status_idx" ON "ingest_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ingest_jobs_created_idx" ON "ingest_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ingest_jobs_provider_idx" ON "ingest_jobs" USING btree ("provider","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_sectors_symbol_taxonomy_idx" ON "instrument_sectors" USING btree ("symbol","taxonomy");--> statement-breakpoint
CREATE INDEX "instrument_sectors_lookup_idx" ON "instrument_sectors" USING btree ("taxonomy","sector_code");--> statement-breakpoint
CREATE INDEX "instruments_market_idx" ON "instruments" USING btree ("market");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grants_user_client_idx" ON "oauth_grants" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_user_id_idx" ON "oauth_grants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_hash_idx" ON "oauth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "oauth_tokens_grant_id_idx" ON "oauth_tokens" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_family_id_idx" ON "oauth_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_idx" ON "users" USING btree ("google_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_unique_idx" ON "watchlist_items" USING btree ("watchlist_id","kind","ref");--> statement-breakpoint
CREATE INDEX "watchlist_items_list_idx" ON "watchlist_items" USING btree ("watchlist_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlists_user_name_idx" ON "watchlists" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "watchlists_user_updated_idx" ON "watchlists" USING btree ("user_id","updated_at");