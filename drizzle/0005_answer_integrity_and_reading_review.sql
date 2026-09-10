-- Two additions, both purely additive. No existing row is read or rewritten.
--
-- `review_events.submission_id` is the idempotency key for an answer. Nulls are
-- distinct in a Postgres unique index, so the rows written before it existed —
-- all null — never collide with one another.
--
-- The `en_definition_ko_*` columns hold a model's proposed reading beside the
-- published one instead of on top of it, so a suggestion cannot reach a student
-- before a curator has read it, and generating one cannot blank a reading that
-- is already live. Existing readings stay exactly where they are, in
-- `en_definition_ko`, and count as approved content.

ALTER TABLE "brain_map_meanings" ADD COLUMN "en_definition_ko_draft" text;--> statement-breakpoint
ALTER TABLE "brain_map_meanings" ADD COLUMN "en_definition_ko_model" text;--> statement-breakpoint
ALTER TABLE "brain_map_meanings" ADD COLUMN "en_definition_ko_prompt_version" text;--> statement-breakpoint
ALTER TABLE "brain_map_meanings" ADD COLUMN "en_definition_ko_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brain_map_meanings" ADD COLUMN "en_definition_ko_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "brain_map_meanings" ADD COLUMN "en_definition_ko_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_events" ADD COLUMN "submission_id" uuid;--> statement-breakpoint
ALTER TABLE "brain_map_meanings" ADD CONSTRAINT "brain_map_meanings_en_definition_ko_approved_by_users_id_fk" FOREIGN KEY ("en_definition_ko_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_events_submission_key" ON "review_events" USING btree ("submission_id");