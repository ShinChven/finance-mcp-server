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
	"name" text NOT NULL,
	"fund_type" text,
	"is_qdii" boolean DEFAULT false NOT NULL,
	"is_index_fund" boolean DEFAULT false NOT NULL,
	"tracking_index" text,
	"tracking_index_code" text,
	"company" text,
	"manager" text,
	"fee_rate" double precision,
	"fund_size" double precision,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"listed_symbol" text,
	"purchase_status" text,
	"purchase_limit" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_constituents" (
	"index_code" text NOT NULL,
	"symbol" text NOT NULL,
	"weight" double precision,
	"as_of" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
ALTER TABLE "fund_exposure" ADD CONSTRAINT "fund_exposure_fund_code_funds_code_fk" FOREIGN KEY ("fund_code") REFERENCES "public"."funds"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_holdings" ADD CONSTRAINT "fund_holdings_fund_code_funds_code_fk" FOREIGN KEY ("fund_code") REFERENCES "public"."funds"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_nav" ADD CONSTRAINT "fund_nav_fund_code_funds_code_fk" FOREIGN KEY ("fund_code") REFERENCES "public"."funds"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fund_exposure_unique_idx" ON "fund_exposure" USING btree ("fund_code","dimension","taxonomy","key");--> statement-breakpoint
CREATE INDEX "fund_exposure_lookup_idx" ON "fund_exposure" USING btree ("dimension","taxonomy","key","weight");--> statement-breakpoint
CREATE UNIQUE INDEX "fund_holdings_unique_idx" ON "fund_holdings" USING btree ("fund_code","symbol","report_date");--> statement-breakpoint
CREATE INDEX "fund_holdings_symbol_idx" ON "fund_holdings" USING btree ("symbol","weight");--> statement-breakpoint
CREATE INDEX "fund_holdings_fund_report_idx" ON "fund_holdings" USING btree ("fund_code","report_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fund_nav_unique_idx" ON "fund_nav" USING btree ("fund_code","nav_date");--> statement-breakpoint
CREATE INDEX "funds_qdii_idx" ON "funds" USING btree ("is_qdii");--> statement-breakpoint
CREATE INDEX "funds_tracking_index_idx" ON "funds" USING btree ("tracking_index_code");--> statement-breakpoint
CREATE UNIQUE INDEX "index_constituents_unique_idx" ON "index_constituents" USING btree ("index_code","symbol","as_of");--> statement-breakpoint
CREATE INDEX "index_constituents_symbol_idx" ON "index_constituents" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_sectors_symbol_taxonomy_idx" ON "instrument_sectors" USING btree ("symbol","taxonomy");--> statement-breakpoint
CREATE INDEX "instrument_sectors_lookup_idx" ON "instrument_sectors" USING btree ("taxonomy","sector_code");--> statement-breakpoint
CREATE INDEX "instruments_market_idx" ON "instruments" USING btree ("market");