CREATE TYPE "public"."skill_source" AS ENUM('agent', 'web');--> statement-breakpoint
CREATE TYPE "public"."skill_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "skill_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"name" text NOT NULL,
	"when_to_use" text NOT NULL,
	"body" text NOT NULL,
	"source" "skill_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"when_to_use" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" "skill_status" DEFAULT 'active' NOT NULL,
	"source" "skill_source" DEFAULT 'web' NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("skills"."slug", '') || ' ' || coalesce("skills"."name", '')), 'A') || setweight(to_tsvector('simple', coalesce("skills"."when_to_use", '')), 'B') || setweight(to_tsvector('simple', coalesce("skills"."body", '')), 'C')) STORED
);
--> statement-breakpoint
ALTER TABLE "skill_revisions" ADD CONSTRAINT "skill_revisions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_revisions_skill_idx" ON "skill_revisions" USING btree ("skill_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_user_slug_idx" ON "skills" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "skills_user_status_idx" ON "skills" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "skills_search_idx" ON "skills" USING gin ("search_vector");