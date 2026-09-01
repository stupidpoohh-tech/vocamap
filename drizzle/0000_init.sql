CREATE TYPE "public"."brain_map_status" AS ENUM('draft_ai', 'needs_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."important_reason" AS ENUM('teacher_selected', 'student_selected', 'frequent_error', 'exam', 'system_recommended');--> statement-breakpoint
CREATE TYPE "public"."link_status" AS ENUM('pending', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."node_status" AS ENUM('locked', 'available', 'learning', 'weak', 'mastered');--> statement-breakpoint
CREATE TYPE "public"."node_type" AS ENUM('meaning_core', 'sentences', 'similar_words', 'collocations', 'word_family');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('recall_choice', 'recall_typed', 'sentence_translation', 'similar_battle', 'collocation_cloze', 'word_family_cloze');--> statement-breakpoint
CREATE TYPE "public"."review_direction" AS ENUM('en_ko', 'ko_en');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'teacher', 'admin');--> statement-breakpoint
CREATE TABLE "ai_generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vocabulary_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" "generation_status" DEFAULT 'pending' NOT NULL,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"raw_response" text,
	"error" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"assigned_by" uuid,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_map_collocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brain_map_id" uuid NOT NULL,
	"expression" text NOT NULL,
	"ko" text NOT NULL,
	"example_sentence" text,
	"importance" smallint DEFAULT 2 NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_map_meanings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brain_map_id" uuid NOT NULL,
	"ko" text NOT NULL,
	"en_definition" text,
	"connection_note" text,
	"example_chunk" text,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_map_node_progress" (
	"user_id" uuid NOT NULL,
	"vocabulary_id" uuid NOT NULL,
	"node" "node_type" NOT NULL,
	"status" "node_status" DEFAULT 'available' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"last_studied_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brain_map_node_progress_user_id_vocabulary_id_node_pk" PRIMARY KEY("user_id","vocabulary_id","node")
);
--> statement-breakpoint
CREATE TABLE "brain_map_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brain_map_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"change_kind" text NOT NULL,
	"changed_by" uuid,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_map_sentences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brain_map_id" uuid NOT NULL,
	"text" text NOT NULL,
	"ko" text NOT NULL,
	"target_meaning" text,
	"highlight" text,
	"difficulty" smallint,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_map_similar_words" (
	"brain_map_id" uuid NOT NULL,
	"pair_id" uuid NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "brain_map_similar_words_brain_map_id_pair_id_pk" PRIMARY KEY("brain_map_id","pair_id")
);
--> statement-breakpoint
CREATE TABLE "brain_map_word_family" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brain_map_id" uuid NOT NULL,
	"lemma" text NOT NULL,
	"part_of_speech" text NOT NULL,
	"ko" text NOT NULL,
	"example_sentence" text,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vocabulary_id" uuid NOT NULL,
	"status" "brain_map_status" DEFAULT 'draft_ai' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"meaning_core_ko" text,
	"meaning_core_en" text,
	"generated_by_model" text,
	"prompt_version" text,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brain_maps_vocabularyId_unique" UNIQUE("vocabulary_id")
);
--> statement-breakpoint
CREATE TABLE "learning_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vocabulary_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vocabulary_id" uuid NOT NULL,
	"direction" "review_direction",
	"question_type" "question_type" NOT NULL,
	"node_type" "node_type",
	"correct" boolean NOT NULL,
	"response_time_ms" integer,
	"payload" jsonb,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_student_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "link_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_confusions" (
	"user_id" uuid NOT NULL,
	"pair_id" uuid NOT NULL,
	"wrong_count" integer DEFAULT 0 NOT NULL,
	"right_count" integer DEFAULT 0 NOT NULL,
	"last_wrong_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_confusions_user_id_pair_id_pk" PRIMARY KEY("user_id","pair_id")
);
--> statement-breakpoint
CREATE TABLE "user_vocabulary_cards" (
	"user_id" uuid NOT NULL,
	"vocabulary_id" uuid NOT NULL,
	"direction" "review_direction" NOT NULL,
	"stability" real DEFAULT 0 NOT NULL,
	"difficulty" real DEFAULT 0 NOT NULL,
	"fsrs_state" smallint DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"elapsed_days" real DEFAULT 0 NOT NULL,
	"scheduled_days" real DEFAULT 0 NOT NULL,
	"learning_steps" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"consecutive_correct" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_vocabulary_cards_user_id_vocabulary_id_direction_pk" PRIMARY KEY("user_id","vocabulary_id","direction")
);
--> statement-breakpoint
CREATE TABLE "user_vocabulary_state" (
	"user_id" uuid NOT NULL,
	"vocabulary_id" uuid NOT NULL,
	"is_important" boolean DEFAULT false NOT NULL,
	"important_reason" "important_reason",
	"marked_by" uuid,
	"brain_map_recommended_at" timestamp with time zone,
	"brain_map_opened_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_vocabulary_state_user_id_vocabulary_id_pk" PRIMARY KEY("user_id","vocabulary_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocabularies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lemma" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"part_of_speech" text,
	"level" text,
	"frequency_rank" integer,
	"is_seed" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocabulary_set_items" (
	"set_id" uuid NOT NULL,
	"vocabulary_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "vocabulary_set_items_set_id_vocabulary_id_pk" PRIMARY KEY("set_id","vocabulary_id")
);
--> statement-breakpoint
CREATE TABLE "vocabulary_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_seed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocabulary_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vocabulary_id" uuid NOT NULL,
	"language" text DEFAULT 'ko' NOT NULL,
	"text" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_pair_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"answer" text NOT NULL,
	"explanation" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lemma_a" text NOT NULL,
	"lemma_b" text NOT NULL,
	"core_difference" text NOT NULL,
	"usage_rule" text,
	"status" "brain_map_status" DEFAULT 'draft_ai' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"generated_by_model" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_generation_jobs" ADD CONSTRAINT "ai_generation_jobs_vocabulary_id_vocabularies_id_fk" FOREIGN KEY ("vocabulary_id") REFERENCES "public"."vocabularies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation_jobs" ADD CONSTRAINT "ai_generation_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_set_id_vocabulary_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."vocabulary_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_map_collocations" ADD CONSTRAINT "brain_map_collocations_brain_map_id_brain_maps_id_fk" FOREIGN KEY ("brain_map_id") REFERENCES "public"."brain_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_map_meanings" ADD CONSTRAINT "brain_map_meanings_brain_map_id_brain_maps_id_fk" FOREIGN KEY ("brain_map_id") REFERENCES "public"."brain_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_map_node_progress" ADD CONSTRAINT "brain_map_node_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_map_node_progress" ADD CONSTRAINT "brain_map_node_progress_vocabulary_id_vocabularies_id_fk" FOREIGN KEY ("vocabulary_id") REFERENCES "public"."vocabularies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_map_revisions" ADD CONSTRAINT "brain_map_revisions_brain_map_id_brain_maps_id_fk" FOREIGN KEY ("brain_map_id") REFERENCES "public"."brain_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_map_revisions" ADD CONSTRAINT "brain_map_revisions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_map_sentences" ADD CONSTRAINT "brain_map_sentences_brain_map_id_brain_maps_id_fk" FOREIGN KEY ("brain_map_id") REFERENCES "public"."brain_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_map_similar_words" ADD CONSTRAINT "brain_map_similar_words_brain_map_id_brain_maps_id_fk" FOREIGN KEY ("brain_map_id") REFERENCES "public"."brain_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_map_similar_words" ADD CONSTRAINT "brain_map_similar_words_pair_id_word_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."word_pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_map_word_family" ADD CONSTRAINT "brain_map_word_family_brain_map_id_brain_maps_id_fk" FOREIGN KEY ("brain_map_id") REFERENCES "public"."brain_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_maps" ADD CONSTRAINT "brain_maps_vocabulary_id_vocabularies_id_fk" FOREIGN KEY ("vocabulary_id") REFERENCES "public"."vocabularies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_maps" ADD CONSTRAINT "brain_maps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_maps" ADD CONSTRAINT "brain_maps_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_vocabulary_id_vocabularies_id_fk" FOREIGN KEY ("vocabulary_id") REFERENCES "public"."vocabularies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_vocabulary_id_vocabularies_id_fk" FOREIGN KEY ("vocabulary_id") REFERENCES "public"."vocabularies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_student_links" ADD CONSTRAINT "teacher_student_links_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_student_links" ADD CONSTRAINT "teacher_student_links_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_confusions" ADD CONSTRAINT "user_confusions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_confusions" ADD CONSTRAINT "user_confusions_pair_id_word_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."word_pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary_cards" ADD CONSTRAINT "user_vocabulary_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary_cards" ADD CONSTRAINT "user_vocabulary_cards_vocabulary_id_vocabularies_id_fk" FOREIGN KEY ("vocabulary_id") REFERENCES "public"."vocabularies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary_state" ADD CONSTRAINT "user_vocabulary_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary_state" ADD CONSTRAINT "user_vocabulary_state_vocabulary_id_vocabularies_id_fk" FOREIGN KEY ("vocabulary_id") REFERENCES "public"."vocabularies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary_state" ADD CONSTRAINT "user_vocabulary_state_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabularies" ADD CONSTRAINT "vocabularies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_set_items" ADD CONSTRAINT "vocabulary_set_items_set_id_vocabulary_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."vocabulary_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_set_items" ADD CONSTRAINT "vocabulary_set_items_vocabulary_id_vocabularies_id_fk" FOREIGN KEY ("vocabulary_id") REFERENCES "public"."vocabularies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_sets" ADD CONSTRAINT "vocabulary_sets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_translations" ADD CONSTRAINT "vocabulary_translations_vocabulary_id_vocabularies_id_fk" FOREIGN KEY ("vocabulary_id") REFERENCES "public"."vocabularies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_pair_questions" ADD CONSTRAINT "word_pair_questions_pair_id_word_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."word_pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_pairs" ADD CONSTRAINT "word_pairs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_jobs_vocab_idx" ON "ai_generation_jobs" USING btree ("vocabulary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_jobs_inflight_unique" ON "ai_generation_jobs" USING btree ("vocabulary_id","kind") WHERE status in ('pending','running');--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_unique" ON "assignments" USING btree ("set_id","student_id");--> statement-breakpoint
CREATE INDEX "assignments_student_idx" ON "assignments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "bm_collocations_map_idx" ON "brain_map_collocations" USING btree ("brain_map_id");--> statement-breakpoint
CREATE INDEX "bm_meanings_map_idx" ON "brain_map_meanings" USING btree ("brain_map_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bm_revisions_unique" ON "brain_map_revisions" USING btree ("brain_map_id","version");--> statement-breakpoint
CREATE INDEX "bm_sentences_map_idx" ON "brain_map_sentences" USING btree ("brain_map_id");--> statement-breakpoint
CREATE INDEX "bm_word_family_map_idx" ON "brain_map_word_family" USING btree ("brain_map_id");--> statement-breakpoint
CREATE INDEX "brain_maps_status_idx" ON "brain_maps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "learning_events_user_time_idx" ON "learning_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "review_events_user_time_idx" ON "review_events" USING btree ("user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "review_events_vocab_idx" ON "review_events" USING btree ("vocabulary_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_student_unique" ON "teacher_student_links" USING btree ("teacher_id","student_id");--> statement-breakpoint
CREATE INDEX "teacher_student_student_idx" ON "teacher_student_links" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "uvc_due_idx" ON "user_vocabulary_cards" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "uvs_recommended_idx" ON "user_vocabulary_state" USING btree ("user_id","brain_map_recommended_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "vocabularies_natural_key" ON "vocabularies" USING btree (lower("lemma"),"language",coalesce("part_of_speech", ''));--> statement-breakpoint
CREATE INDEX "vocabularies_lemma_trgm" ON "vocabularies" USING btree (lower("lemma") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "vocabulary_sets_owner_idx" ON "vocabulary_sets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "vocab_translations_vocab_idx" ON "vocabulary_translations" USING btree ("vocabulary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vocab_translations_unique" ON "vocabulary_translations" USING btree ("vocabulary_id","language",lower("text"));--> statement-breakpoint
CREATE INDEX "word_pair_questions_pair_idx" ON "word_pair_questions" USING btree ("pair_id");--> statement-breakpoint
CREATE UNIQUE INDEX "word_pairs_unique" ON "word_pairs" USING btree ("lemma_a","lemma_b");