-- Consent and verification.
--
-- Nothing is deleted here: no account, no link, no map, no review event. What
-- changes is what counts as permission — rows that were trusted for what they
-- claimed now have to carry evidence of who checked.
--
-- `users.teacher_verified_at` is null for every existing account, including
-- every current teacher. Sign-up took the role from the form, so a `teacher`
-- row proves only that somebody typed "teacher"; there is no record that would
-- separate an invited tutor from a self-declared one, and guessing in the
-- permissive direction is the bug being fixed. An admin verifies them after
-- deploy — see docs/OPERATIONS.md.

ALTER TABLE "teacher_student_links" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "teacher_student_links" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "teacher_student_links" ADD COLUMN "consented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teacher_student_links" ADD COLUMN "consented_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "teacher_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "teacher_verified_by" uuid;--> statement-breakpoint
ALTER TABLE "teacher_student_links" ADD CONSTRAINT "teacher_student_links_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_student_links" ADD CONSTRAINT "teacher_student_links_consented_by_users_id_fk" FOREIGN KEY ("consented_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_teacher_verified_by_users_id_fk" FOREIGN KEY ("teacher_verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Links that are active with nothing behind them go back to pending.
--
-- The row stays, the teacher stays, and every review event, card and assignment
-- is untouched. What stops is the reading of that student's record until they
-- say yes; a student who was genuinely invited says yes once and is back where
-- they were.
UPDATE "teacher_student_links"
SET "status" = 'pending'
WHERE "status" = 'active' AND "consented_at" IS NULL;
