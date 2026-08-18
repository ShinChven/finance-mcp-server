CREATE TYPE "public"."watchlist_item_kind" AS ENUM('symbol', 'fund');--> statement-breakpoint
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
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_unique_idx" ON "watchlist_items" USING btree ("watchlist_id","kind","ref");--> statement-breakpoint
CREATE INDEX "watchlist_items_list_idx" ON "watchlist_items" USING btree ("watchlist_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlists_user_name_idx" ON "watchlists" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "watchlists_user_updated_idx" ON "watchlists" USING btree ("user_id","updated_at");