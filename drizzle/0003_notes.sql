CREATE TYPE "public"."note_source" AS ENUM('agent', 'web');--> statement-breakpoint
CREATE TYPE "public"."note_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "note_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_symbols" (
	"note_id" text NOT NULL,
	"kind" "watchlist_item_kind" NOT NULL,
	"ref" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_tags" (
	"note_id" text NOT NULL,
	"tag" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"collection_id" text,
	"title" text NOT NULL,
	"summary" text,
	"body" text DEFAULT '' NOT NULL,
	"status" "note_status" DEFAULT 'active' NOT NULL,
	"source" "note_source" DEFAULT 'web' NOT NULL,
	"source_ref" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("notes"."title", '')), 'A') || setweight(to_tsvector('simple', coalesce("notes"."summary", '')), 'B') || setweight(to_tsvector('simple', coalesce("notes"."body", '')), 'C')) STORED
);
--> statement-breakpoint
ALTER TABLE "note_collections" ADD CONSTRAINT "note_collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_symbols" ADD CONSTRAINT "note_symbols_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_collection_id_note_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."note_collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_collections_user_name_idx" ON "note_collections" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "note_collections_user_updated_idx" ON "note_collections" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "note_symbols_unique_idx" ON "note_symbols" USING btree ("note_id","kind","ref");--> statement-breakpoint
CREATE INDEX "note_symbols_ref_idx" ON "note_symbols" USING btree ("ref");--> statement-breakpoint
CREATE UNIQUE INDEX "note_tags_unique_idx" ON "note_tags" USING btree ("note_id","tag");--> statement-breakpoint
CREATE INDEX "note_tags_tag_idx" ON "note_tags" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "notes_user_updated_idx" ON "notes" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "notes_user_status_idx" ON "notes" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "notes_collection_idx" ON "notes" USING btree ("collection_id","updated_at");--> statement-breakpoint
CREATE INDEX "notes_search_idx" ON "notes" USING gin ("search_vector");