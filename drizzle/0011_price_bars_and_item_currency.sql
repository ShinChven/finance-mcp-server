CREATE TABLE "price_bar_meta" (
	"symbol" text PRIMARY KEY NOT NULL,
	"timezone" text NOT NULL,
	"currency" text,
	"first_bar" date,
	"last_bar" date,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_bars" (
	"symbol" text NOT NULL,
	"bar_date" date NOT NULL,
	"open" double precision,
	"high" double precision,
	"low" double precision,
	"close" double precision,
	"adj_close" double precision,
	"volume" double precision
);
--> statement-breakpoint
CREATE TABLE "price_events" (
	"symbol" text NOT NULL,
	"event_date" date NOT NULL,
	"kind" text NOT NULL,
	"factor" double precision,
	"amount" double precision
);
--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD COLUMN "currency" text;--> statement-breakpoint
CREATE UNIQUE INDEX "price_bars_unique_idx" ON "price_bars" USING btree ("symbol","bar_date");--> statement-breakpoint
CREATE UNIQUE INDEX "price_events_unique_idx" ON "price_events" USING btree ("symbol","event_date","kind");