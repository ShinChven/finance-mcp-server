CREATE TYPE "public"."watchlist_level_kind" AS ENUM('support', 'resistance', 'target', 'stop', 'entry');--> statement-breakpoint
CREATE TYPE "public"."watchlist_level_source" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."watchlist_level_status" AS ENUM('active', 'hit', 'invalidated');--> statement-breakpoint
CREATE TABLE "watchlist_levels" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"kind" "watchlist_level_kind" NOT NULL,
	"price" double precision NOT NULL,
	"price_high" double precision,
	"label" text,
	"note" text,
	"source" "watchlist_level_source" DEFAULT 'user' NOT NULL,
	"status" "watchlist_level_status" DEFAULT 'active' NOT NULL,
	"hit_at" timestamp with time zone,
	"valid_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD COLUMN "entry_price" double precision;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD COLUMN "entry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "watchlist_levels" ADD CONSTRAINT "watchlist_levels_item_id_watchlist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."watchlist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_levels_unique_idx" ON "watchlist_levels" USING btree ("item_id","kind","price");--> statement-breakpoint
CREATE INDEX "watchlist_levels_item_idx" ON "watchlist_levels" USING btree ("item_id","status","price");