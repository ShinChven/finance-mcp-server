-- The single `target_price` column becomes one row in `watchlist_levels`, so
-- nothing a user set is lost when the column goes. `source` stays 'user':
-- every target that exists today was typed by a person or written by an agent
-- on their behalf, and there is no record of which.
INSERT INTO "watchlist_levels" ("id", "item_id", "kind", "price", "source", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "id", 'target', "target_price", 'user', "created_at", now()
FROM "watchlist_items"
WHERE "target_price" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "watchlist_items" DROP COLUMN "target_price";
