-- Two additive columns on `users`. No existing row is read or rewritten, and
-- both are null for every account that already exists — which is the correct
-- reading: nobody has been issued a temporary password.
--
-- `must_change_password_at` is what stops an admin-issued password from
-- quietly becoming somebody's permanent one. It is set when the password is
-- issued and cleared when the owner replaces it, so the state lives in the
-- database rather than in a promise that the student will get round to it.

ALTER TABLE "users" ADD COLUMN "must_change_password_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_password_reset_by_users_id_fk" FOREIGN KEY ("password_reset_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
