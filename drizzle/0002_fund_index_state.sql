CREATE TABLE "fund_index_state" (
	"provider" text PRIMARY KEY NOT NULL,
	"fund_count" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text
);
