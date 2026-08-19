ALTER TABLE "instruments" ADD COLUMN "isin" text;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "exchange" text;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "market_cap" double precision;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "market_cap_usd" double precision;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "profile_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_isin_idx" ON "instruments" USING btree ("isin") WHERE "instruments"."isin" is not null;--> statement-breakpoint
CREATE INDEX "instruments_market_cap_idx" ON "instruments" USING btree ("market_cap_usd");--> statement-breakpoint
CREATE INDEX "instruments_profile_synced_idx" ON "instruments" USING btree ("profile_synced_at");