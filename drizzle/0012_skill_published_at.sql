ALTER TABLE "skills" ADD COLUMN "published_at" timestamp with time zone;
--> statement-breakpoint
-- Existing active skills were made callable by a person, so they carry the
-- re-enable right. `created_at` is the closest honest stamp we have.
--
-- Rows already archived stay null on purpose: nothing records whether they were
-- ever reviewed, and guessing permissively is the single mistake this column
-- exists to prevent. One dashboard publish restores the right.
UPDATE "skills" SET "published_at" = "created_at" WHERE "status" = 'active';
