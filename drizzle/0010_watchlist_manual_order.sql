ALTER TABLE "watchlist_items" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "watchlists" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "watchlist_items_position_idx" ON "watchlist_items" USING btree ("watchlist_id","position");--> statement-breakpoint
CREATE INDEX "watchlists_user_position_idx" ON "watchlists" USING btree ("user_id","position");--> statement-breakpoint
-- Backfill in the order these rows are shown today, so turning the column on
-- moves nothing: lists most-recently-touched first, items most-recently-added
-- first. Everything left at the default 0 would otherwise tie, and a tie is
-- resolved by the fallback ordering — correct, but it would make the first
-- drag look like it reshuffled the whole list.
UPDATE "watchlists" AS w
SET "position" = ranked."rank"
FROM (
  SELECT "id", (row_number() OVER (PARTITION BY "user_id" ORDER BY "updated_at" DESC, "id")) - 1 AS "rank"
  FROM "watchlists"
) AS ranked
WHERE w."id" = ranked."id";--> statement-breakpoint
UPDATE "watchlist_items" AS i
SET "position" = ranked."rank"
FROM (
  SELECT "id", (row_number() OVER (PARTITION BY "watchlist_id" ORDER BY "created_at" DESC, "id")) - 1 AS "rank"
  FROM "watchlist_items"
) AS ranked
WHERE i."id" = ranked."id";
