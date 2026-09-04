import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/* ────────────────────────────── enums ────────────────────────────── */

export const userRole = pgEnum('user_role', ['student', 'teacher', 'admin'])

/** Recall direction. `en_ko` = see English, produce Korean. */
export const reviewDirection = pgEnum('review_direction', ['en_ko', 'ko_en'])

export const questionType = pgEnum('question_type', [
  'recall_choice',
  'recall_typed',
  'sentence_translation',
  'similar_battle',
  'collocation_cloze',
  'word_family_cloze',
])

export const brainMapStatus = pgEnum('brain_map_status', [
  'draft_ai',
  'needs_review',
  'approved',
  'rejected',
])

export const nodeType = pgEnum('node_type', [
  'meaning_core',
  'sentences',
  'similar_words',
  'collocations',
  'word_family',
])

export const nodeStatus = pgEnum('node_status', [
  'locked',
  'available',
  'learning',
  'weak',
  'mastered',
])

export const importantReason = pgEnum('important_reason', [
  'teacher_selected',
  'student_selected',
  'frequent_error',
  'exam',
  'system_recommended',
])

export const generationStatus = pgEnum('generation_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
])

export const linkStatus = pgEnum('link_status', ['pending', 'active', 'revoked'])

/* ────────────────────────────── identity ────────────────────────────── */

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    displayName: text().notNull(),
    role: userRole().notNull().default('student'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_key').on(sql`lower(${t.email})`)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

/**
 * Teacher ↔ student edges. Every teacher-side read is scoped through an
 * `active` row here; there is no other way for a teacher to see a student.
 */
export const teacherStudentLinks = pgTable(
  'teacher_student_links',
  {
    id: uuid().primaryKey().defaultRandom(),
    teacherId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: linkStatus().notNull().default('active'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('teacher_student_unique').on(t.teacherId, t.studentId),
    index('teacher_student_student_idx').on(t.studentId),
  ],
)

/* ────────────────────────────── vocabulary ────────────────────────────── */

/**
 * One row per (lemma, language, part of speech). This is the dedupe anchor for
 * the whole shared knowledge base — see `vocabularies_natural_key`.
 */
export const vocabularies = pgTable(
  'vocabularies',
  {
    id: uuid().primaryKey().defaultRandom(),
    lemma: text().notNull(),
    language: text().notNull().default('en'),
    partOfSpeech: text(),
    /**
     * How the word is said, as the wordbook prints it — e.g. `kəntémpərèri`.
     * Nullable and never guessed: a made-up transcription is worse than none,
     * and the browser can speak the word without one either way.
     */
    pronunciation: text(),
    /** CEFR-ish label. Nullable on purpose: we do not invent levels. */
    level: text(),
    /** Lower is more frequent. Nullable until we import a real frequency list. */
    frequencyRank: integer(),
    isSeed: boolean().notNull().default(false),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('vocabularies_natural_key').on(
      sql`lower(${t.lemma})`,
      t.language,
      sql`coalesce(${t.partOfSpeech}, '')`,
    ),
    index('vocabularies_lemma_trgm').on(sql`lower(${t.lemma}) text_pattern_ops`),
  ],
)

/** Korean glosses. `isPrimary` is the one shown in recall prompts. */
export const vocabularyTranslations = pgTable(
  'vocabulary_translations',
  {
    id: uuid().primaryKey().defaultRandom(),
    vocabularyId: uuid()
      .notNull()
      .references(() => vocabularies.id, { onDelete: 'cascade' }),
    language: text().notNull().default('ko'),
    text: text().notNull(),
    isPrimary: boolean().notNull().default(false),
    sortOrder: smallint().notNull().default(0),
  },
  (t) => [
    index('vocab_translations_vocab_idx').on(t.vocabularyId),
    uniqueIndex('vocab_translations_unique').on(
      t.vocabularyId,
      t.language,
      sql`lower(${t.text})`,
    ),
  ],
)

/* ─────────────────────── master brain map (shared) ─────────────────────── */

/**
 * WHAT THE WORD IS. Exactly one master map per vocabulary; never per student.
 */
export const brainMaps = pgTable(
  'brain_maps',
  {
    id: uuid().primaryKey().defaultRandom(),
    vocabularyId: uuid()
      .notNull()
      .unique()
      .references(() => vocabularies.id, { onDelete: 'cascade' }),
    status: brainMapStatus().notNull().default('draft_ai'),
    version: integer().notNull().default(1),
    /** The single organising idea all senses hang off. */
    meaningCoreKo: text(),
    meaningCoreEn: text(),
    generatedByModel: text(),
    promptVersion: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp({ withTimezone: true }),
    reviewNote: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('brain_maps_status_idx').on(t.status)],
)

/** Individual senses, each explained as a branch off the meaning core. */
export const brainMapMeanings = pgTable(
  'brain_map_meanings',
  {
    id: uuid().primaryKey().defaultRandom(),
    brainMapId: uuid()
      .notNull()
      .references(() => brainMaps.id, { onDelete: 'cascade' }),
    ko: text().notNull(),
    enDefinition: text(),
    /** How this sense follows from the meaning core. The teaching payload. */
    connectionNote: text(),
    exampleChunk: text(),
    sortOrder: smallint().notNull().default(0),
  },
  (t) => [index('bm_meanings_map_idx').on(t.brainMapId)],
)

export const brainMapSentences = pgTable(
  'brain_map_sentences',
  {
    id: uuid().primaryKey().defaultRandom(),
    brainMapId: uuid()
      .notNull()
      .references(() => brainMaps.id, { onDelete: 'cascade' }),
    text: text().notNull(),
    ko: text().notNull(),
    /** Which sense this sentence demonstrates. Keeps the 5 sentences distinct. */
    targetMeaning: text(),
    /** Substring of `text` to highlight, verbatim. */
    highlight: text(),
    difficulty: smallint(),
    sortOrder: smallint().notNull().default(0),
  },
  (t) => [index('bm_sentences_map_idx').on(t.brainMapId)],
)

export const brainMapCollocations = pgTable(
  'brain_map_collocations',
  {
    id: uuid().primaryKey().defaultRandom(),
    brainMapId: uuid()
      .notNull()
      .references(() => brainMaps.id, { onDelete: 'cascade' }),
    expression: text().notNull(),
    ko: text().notNull(),
    exampleSentence: text(),
    /** 1 = must know, 3 = nice to know. Caps the list at what is worth teaching. */
    importance: smallint().notNull().default(2),
    sortOrder: smallint().notNull().default(0),
  },
  (t) => [index('bm_collocations_map_idx').on(t.brainMapId)],
)

export const brainMapWordFamily = pgTable(
  'brain_map_word_family',
  {
    id: uuid().primaryKey().defaultRandom(),
    brainMapId: uuid()
      .notNull()
      .references(() => brainMaps.id, { onDelete: 'cascade' }),
    lemma: text().notNull(),
    partOfSpeech: text().notNull(),
    ko: text().notNull(),
    exampleSentence: text(),
    sortOrder: smallint().notNull().default(0),
  },
  (t) => [index('bm_word_family_map_idx').on(t.brainMapId)],
)

/**
 * Confusable pairs live at the top level, not under one brain map: "maintain vs
 * keep" is symmetric and has to be reachable from both words' maps.
 * Normalised so that lemmaA < lemmaB, which makes the unique index total.
 */
export const wordPairs = pgTable(
  'word_pairs',
  {
    id: uuid().primaryKey().defaultRandom(),
    lemmaA: text().notNull(),
    lemmaB: text().notNull(),
    coreDifference: text().notNull(),
    usageRule: text(),
    status: brainMapStatus().notNull().default('draft_ai'),
    version: integer().notNull().default(1),
    generatedByModel: text(),
    approvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // Lemmas are stored already normalised (lowercased, trimmed) and ordered so
  // that lemmaA < lemmaB, which makes a plain unique index total over pairs.
  (t) => [uniqueIndex('word_pairs_unique').on(t.lemmaA, t.lemmaB)],
)

export const wordPairQuestions = pgTable(
  'word_pair_questions',
  {
    id: uuid().primaryKey().defaultRandom(),
    pairId: uuid()
      .notNull()
      .references(() => wordPairs.id, { onDelete: 'cascade' }),
    /** Sentence containing exactly one `___` blank. */
    prompt: text().notNull(),
    answer: text().notNull(),
    explanation: text().notNull(),
    sortOrder: smallint().notNull().default(0),
  },
  (t) => [index('word_pair_questions_pair_idx').on(t.pairId)],
)

/** Attaches a shared pair to a specific word's map. */
export const brainMapSimilarWords = pgTable(
  'brain_map_similar_words',
  {
    brainMapId: uuid()
      .notNull()
      .references(() => brainMaps.id, { onDelete: 'cascade' }),
    pairId: uuid()
      .notNull()
      .references(() => wordPairs.id, { onDelete: 'cascade' }),
    sortOrder: smallint().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.brainMapId, t.pairId] })],
)

/**
 * Append-only snapshot log. Cheaper than temporal-versioning six child tables,
 * and enough to answer "what did this map look like at version N, and who
 * changed it". Student history is never touched by an edit.
 */
export const brainMapRevisions = pgTable(
  'brain_map_revisions',
  {
    id: uuid().primaryKey().defaultRandom(),
    brainMapId: uuid()
      .notNull()
      .references(() => brainMaps.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    changeKind: text().notNull(),
    changedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    snapshot: jsonb().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('bm_revisions_unique').on(t.brainMapId, t.version)],
)

/** One row per LLM call. Also the lock that stops duplicate generation. */
export const aiGenerationJobs = pgTable(
  'ai_generation_jobs',
  {
    id: uuid().primaryKey().defaultRandom(),
    vocabularyId: uuid()
      .notNull()
      .references(() => vocabularies.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    status: generationStatus().notNull().default('pending'),
    provider: text(),
    model: text(),
    promptVersion: text(),
    rawResponse: text(),
    error: text(),
    requestedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('ai_jobs_vocab_idx').on(t.vocabularyId),
    // At most one in-flight job per (vocabulary, kind): the duplicate-generation guard.
    uniqueIndex('ai_jobs_inflight_unique')
      .on(t.vocabularyId, t.kind)
      .where(sql`status in ('pending','running')`),
  ],
)

/* ────────────────────────────── sets & assignments ────────────────────────────── */

export const vocabularySets = pgTable(
  'vocabulary_sets',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text(),
    isSeed: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('vocabulary_sets_owner_idx').on(t.ownerId)],
)

export const vocabularySetItems = pgTable(
  'vocabulary_set_items',
  {
    setId: uuid()
      .notNull()
      .references(() => vocabularySets.id, { onDelete: 'cascade' }),
    vocabularyId: uuid()
      .notNull()
      .references(() => vocabularies.id, { onDelete: 'cascade' }),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.setId, t.vocabularyId] })],
)

export const assignments = pgTable(
  'assignments',
  {
    id: uuid().primaryKey().defaultRandom(),
    setId: uuid()
      .notNull()
      .references(() => vocabularySets.id, { onDelete: 'cascade' }),
    studentId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    dueAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('assignments_unique').on(t.setId, t.studentId),
    index('assignments_student_idx').on(t.studentId),
  ],
)

/* ──────────────────── personal brain map (per student) ──────────────────── */

/**
 * HOW THIS STUDENT KNOWS THE WORD — word level.
 * Scheduling state lives one table down, per direction.
 */
export const userVocabularyState = pgTable(
  'user_vocabulary_state',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vocabularyId: uuid()
      .notNull()
      .references(() => vocabularies.id, { onDelete: 'cascade' }),
    /**
     * "I want to study this word." Kept apart from `isImportant` on purpose:
     * marking a word important asks for its Brain Map immediately, and a
     * bookmark must not — most bookmarked words should just be drilled.
     */
    bookmarkedAt: timestamp({ withTimezone: true }),
    isImportant: boolean().notNull().default(false),
    importantReason: importantReason(),
    markedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Set when the system decides this word has earned a brain map. */
    brainMapRecommendedAt: timestamp({ withTimezone: true }),
    brainMapOpenedAt: timestamp({ withTimezone: true }),
    firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.vocabularyId] }),
    index('uvs_recommended_idx').on(t.userId, t.brainMapRecommendedAt),
    index('uvs_bookmarked_idx').on(t.userId, t.bookmarkedAt),
  ],
)

/**
 * FSRS card state. One card per direction, because knowing `maintain → 유지하다`
 * says little about producing `유지하다 → maintain`.
 * `estimatedRetention` is deliberately NOT stored — it decays with wall-clock
 * time, so it is derived from (stability, elapsed) at read time.
 */
export const userVocabularyCards = pgTable(
  'user_vocabulary_cards',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vocabularyId: uuid()
      .notNull()
      .references(() => vocabularies.id, { onDelete: 'cascade' }),
    direction: reviewDirection().notNull(),
    /** FSRS memory state. */
    stability: real().notNull().default(0),
    difficulty: real().notNull().default(0),
    /** 0 new, 1 learning, 2 review, 3 relearning — mirrors ts-fsrs State. */
    fsrsState: smallint().notNull().default(0),
    dueAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastReviewedAt: timestamp({ withTimezone: true }),
    elapsedDays: real().notNull().default(0),
    scheduledDays: real().notNull().default(0),
    /** FSRS learning-step cursor; part of the card state, must round-trip. */
    learningSteps: integer().notNull().default(0),
    reps: integer().notNull().default(0),
    lapses: integer().notNull().default(0),
    consecutiveCorrect: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.vocabularyId, t.direction] }),
    index('uvc_due_idx').on(t.userId, t.dueAt),
  ],
)

/** Graded interactions. Append-only; the substrate for every later analysis. */
export const reviewEvents = pgTable(
  'review_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vocabularyId: uuid()
      .notNull()
      .references(() => vocabularies.id, { onDelete: 'cascade' }),
    direction: reviewDirection(),
    questionType: questionType().notNull(),
    nodeType: nodeType(),
    correct: boolean().notNull(),
    responseTimeMs: integer(),
    /** Free-form context: chosen option, typed answer, pair id, sentence id... */
    payload: jsonb(),
    reviewedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('review_events_user_time_idx').on(t.userId, t.reviewedAt),
    index('review_events_vocab_idx').on(t.vocabularyId, t.reviewedAt),
  ],
)

/** Ungraded interactions: node opened, translation revealed, map expanded. */
export const learningEvents = pgTable(
  'learning_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vocabularyId: uuid().references(() => vocabularies.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    payload: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('learning_events_user_time_idx').on(t.userId, t.createdAt)],
)

/** Per-student status of each of the five brain map nodes. */
export const brainMapNodeProgress = pgTable(
  'brain_map_node_progress',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vocabularyId: uuid()
      .notNull()
      .references(() => vocabularies.id, { onDelete: 'cascade' }),
    node: nodeType().notNull(),
    status: nodeStatus().notNull().default('available'),
    attempts: integer().notNull().default(0),
    correct: integer().notNull().default(0),
    lastStudiedAt: timestamp({ withTimezone: true }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.vocabularyId, t.node] })],
)

/** Per-student confusion graph. Two students confuse different pairs. */
export const userConfusions = pgTable(
  'user_confusions',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pairId: uuid()
      .notNull()
      .references(() => wordPairs.id, { onDelete: 'cascade' }),
    wrongCount: integer().notNull().default(0),
    rightCount: integer().notNull().default(0),
    lastWrongAt: timestamp({ withTimezone: true }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pairId] })],
)

/* ────────────────────────────── relations ────────────────────────────── */

export const vocabulariesRelations = relations(vocabularies, ({ many, one }) => ({
  translations: many(vocabularyTranslations),
  brainMap: one(brainMaps, {
    fields: [vocabularies.id],
    references: [brainMaps.vocabularyId],
  }),
}))

export const vocabularyTranslationsRelations = relations(
  vocabularyTranslations,
  ({ one }) => ({
    vocabulary: one(vocabularies, {
      fields: [vocabularyTranslations.vocabularyId],
      references: [vocabularies.id],
    }),
  }),
)

export const brainMapsRelations = relations(brainMaps, ({ one, many }) => ({
  vocabulary: one(vocabularies, {
    fields: [brainMaps.vocabularyId],
    references: [vocabularies.id],
  }),
  meanings: many(brainMapMeanings),
  sentences: many(brainMapSentences),
  collocations: many(brainMapCollocations),
  wordFamily: many(brainMapWordFamily),
  similarWords: many(brainMapSimilarWords),
}))

export const brainMapMeaningsRelations = relations(brainMapMeanings, ({ one }) => ({
  brainMap: one(brainMaps, {
    fields: [brainMapMeanings.brainMapId],
    references: [brainMaps.id],
  }),
}))

export const brainMapSentencesRelations = relations(brainMapSentences, ({ one }) => ({
  brainMap: one(brainMaps, {
    fields: [brainMapSentences.brainMapId],
    references: [brainMaps.id],
  }),
}))

export const brainMapCollocationsRelations = relations(
  brainMapCollocations,
  ({ one }) => ({
    brainMap: one(brainMaps, {
      fields: [brainMapCollocations.brainMapId],
      references: [brainMaps.id],
    }),
  }),
)

export const brainMapWordFamilyRelations = relations(brainMapWordFamily, ({ one }) => ({
  brainMap: one(brainMaps, {
    fields: [brainMapWordFamily.brainMapId],
    references: [brainMaps.id],
  }),
}))

export const brainMapSimilarWordsRelations = relations(
  brainMapSimilarWords,
  ({ one }) => ({
    brainMap: one(brainMaps, {
      fields: [brainMapSimilarWords.brainMapId],
      references: [brainMaps.id],
    }),
    pair: one(wordPairs, {
      fields: [brainMapSimilarWords.pairId],
      references: [wordPairs.id],
    }),
  }),
)

export const wordPairsRelations = relations(wordPairs, ({ many }) => ({
  questions: many(wordPairQuestions),
}))

export const wordPairQuestionsRelations = relations(wordPairQuestions, ({ one }) => ({
  pair: one(wordPairs, {
    fields: [wordPairQuestions.pairId],
    references: [wordPairs.id],
  }),
}))
