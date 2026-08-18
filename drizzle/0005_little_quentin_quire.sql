CREATE TYPE "public"."ingest_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ingest_scope" AS ENUM('qdii', 'index', 'equity', 'all', 'codes');--> statement-breakpoint
CREATE TABLE "ingest_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" "ingest_scope" NOT NULL,
	"status" "ingest_job_status" DEFAULT 'queued' NOT NULL,
	"requested_by" text,
	"codes" jsonb,
	"fund_limit" double precision,
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
ALTER TABLE "funds" ADD COLUMN "details_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funds" ADD COLUMN "holdings_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funds" ADD COLUMN "nav_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funds" ADD COLUMN "last_sync_error" text;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_jobs_status_idx" ON "ingest_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ingest_jobs_created_idx" ON "ingest_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "funds_holdings_synced_idx" ON "funds" USING btree ("holdings_synced_at");