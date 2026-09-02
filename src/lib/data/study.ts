import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import {
  assignments,
  brainMapNodeProgress,
  learningEvents,
  reviewEvents,
  userConfusions,
  userVocabularyCards,
  userVocabularyState,
  vocabularies,
  vocabularySetItems,
  vocabularyTranslations,
} from '@/lib/db/schema'
import {
  type CardState,
  type Direction,
  emptyCardState,
  estimatedRetention,
  retentionBand,
  review as advanceCard,
} from '@/lib/learning/scheduler'
import { classifyWord, deriveNodeStatus, type WordSignals } from '@/lib/learning/brain-map-policy'
import type { NodeType } from '@/lib/learning/nodes'

export const DIRECTIONS: Direction[] = ['en_ko', 'ko_en']

export type QueueItem = {
  vocabularyId: string
  lemma: string
  translation: string
  direction: Direction
  isNew: boolean
  dueAt: Date
}

export type TodaySummary = {
  dueCount: number
  newCount: number
  recommendedCount: number
}

const DEFAULT_NEW_PER_DAY = 10
const DEFAULT_DUE_LIMIT = 60

/**
 * What this person is being scheduled on.
 *
 * Three ways in, and they union. Saving a word is the deliberate one. An
 * assignment still counts, so a teacher handing a student a set has not had
 * that taken away. And any word the student has already answered is in, which
 * is what makes the open study book work: you can test yourself on the whole
 * library without saving anything, and the words you met still come back on
 * schedule instead of being answered once and forgotten.
 *
 * Only the first two introduce *new* cards, so the daily queue never dumps the
 * entire library on someone as "new words".
 */
async function studyPools(
  userId: string,
  db: Db,
): Promise<{ all: string[]; intake: Set<string> }> {
  const [bookmarked, assigned, studied] = await Promise.all([
    db
      .select({ id: userVocabularyState.vocabularyId })
      .from(userVocabularyState)
      .where(
        and(
          eq(userVocabularyState.userId, userId),
          sql`${userVocabularyState.bookmarkedAt} is not null`,
        ),
      ),
    db
      .selectDistinct({ id: vocabularySetItems.vocabularyId })
      .from(assignments)
      .innerJoin(vocabularySetItems, eq(vocabularySetItems.setId, assignments.setId))
      .where(eq(assignments.studentId, userId)),
    db
      .selectDistinct({ id: userVocabularyCards.vocabularyId })
      .from(userVocabularyCards)
      .where(eq(userVocabularyCards.userId, userId)),
  ])

  // Both pools come out of the same three reads. Working them out separately
  // ran the bookmark and assignment queries twice for every daily queue.
  const intake = new Set([...bookmarked, ...assigned].map((row) => row.id))
  return { all: [...new Set([...intake, ...studied.map((row) => row.id)])], intake }
}

/**
 * Adds or removes a word from the study list.
 *
 * Deliberately not the same act as marking a word important: important asks
 * for the Brain Map right away, while most bookmarked words only ever need
 * drilling. Conflating them would put a recommendation on every bookmark and
 * make the map meaningless.
 */
export async function toggleBookmark(
  input: { userId: string; vocabularyId: string; bookmarked: boolean },
  db: Db = defaultDb,
): Promise<void> {
  const now = new Date()
  await db
    .insert(userVocabularyState)
    .values({
      userId: input.userId,
      vocabularyId: input.vocabularyId,
      bookmarkedAt: input.bookmarked ? now : null,
    })
    .onConflictDoUpdate({
      target: [userVocabularyState.userId, userVocabularyState.vocabularyId],
      set: { bookmarkedAt: input.bookmarked ? now : null, updatedAt: now },
    })
}

export async function bookmarkedIds(
  userId: string,
  vocabularyIds: string[],
  db: Db = defaultDb,
): Promise<Set<string>> {
  if (!vocabularyIds.length) return new Set()
  const rows = await db
    .select({ id: userVocabularyState.vocabularyId })
    .from(userVocabularyState)
    .where(
      and(
        eq(userVocabularyState.userId, userId),
        inArray(userVocabularyState.vocabularyId, vocabularyIds),
        sql`${userVocabularyState.bookmarkedAt} is not null`,
      ),
    )
  return new Set(rows.map((r) => r.id))
}

/**
 * Builds today's session.
 *
 * Due cards come first and are capped, because a student who returns after two
 * weeks should not be shown 400 words — they should be shown the 60 most
 * overdue and get a session they will actually finish. New cards are throttled
 * separately so that a backlog never crowds out new material entirely.
 */
export async function buildTodayQueue(
  userId: string,
  opts: { now?: Date; newLimit?: number; dueLimit?: number } = {},
  db: Db = defaultDb,
): Promise<QueueItem[]> {
  const now = opts.now ?? new Date()
  const newLimit = opts.newLimit ?? DEFAULT_NEW_PER_DAY
  const dueLimit = opts.dueLimit ?? DEFAULT_DUE_LIMIT

  const { all: poolIds, intake: intakeIds } = await studyPools(userId, db)
  if (!poolIds.length) return []

  const primaryTranslation = db
    .$with('primary_translation')
    .as(
      db
        .selectDistinctOn([vocabularyTranslations.vocabularyId], {
          vocabularyId: vocabularyTranslations.vocabularyId,
          text: vocabularyTranslations.text,
        })
        .from(vocabularyTranslations)
        .orderBy(
          asc(vocabularyTranslations.vocabularyId),
          desc(vocabularyTranslations.isPrimary),
          asc(vocabularyTranslations.sortOrder),
        ),
    )

  const rows = await db
    .with(primaryTranslation)
    .select({
      vocabularyId: vocabularies.id,
      lemma: vocabularies.lemma,
      translation: primaryTranslation.text,
      direction: userVocabularyCards.direction,
      dueAt: userVocabularyCards.dueAt,
      reps: userVocabularyCards.reps,
    })
    .from(vocabularies)
    .innerJoin(primaryTranslation, eq(primaryTranslation.vocabularyId, vocabularies.id))
    .leftJoin(
      userVocabularyCards,
      and(
        eq(userVocabularyCards.vocabularyId, vocabularies.id),
        eq(userVocabularyCards.userId, userId),
      ),
    )
    .where(inArray(vocabularies.id, poolIds))
    .orderBy(asc(userVocabularyCards.dueAt), asc(vocabularies.lemma))

  // Fold the per-direction rows into an explicit grid: every assigned word owes
  // two cards, and a missing row simply means "not started".
  const seen = new Map<string, Map<Direction, { dueAt: Date; reps: number }>>()
  const meta = new Map<string, { lemma: string; translation: string }>()

  for (const row of rows) {
    meta.set(row.vocabularyId, { lemma: row.lemma, translation: row.translation })
    if (!row.direction || !row.dueAt) continue
    const byDir = seen.get(row.vocabularyId) ?? new Map()
    byDir.set(row.direction, { dueAt: row.dueAt, reps: row.reps ?? 0 })
    seen.set(row.vocabularyId, byDir)
  }

  const due: QueueItem[] = []
  const fresh: QueueItem[] = []

  for (const [vocabularyId, info] of meta) {
    for (const direction of DIRECTIONS) {
      const card = seen.get(vocabularyId)?.get(direction)
      const item: QueueItem = {
        vocabularyId,
        lemma: info.lemma,
        translation: info.translation,
        direction,
        isNew: !card,
        dueAt: card?.dueAt ?? now,
      }
      if (!card) fresh.push(item)
      else if (card.dueAt.getTime() <= now.getTime()) due.push(item)
    }
  }

  due.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())

  // A word's two directions are introduced together so the student meets the
  // form and the meaning in the same sitting. Only saved and assigned words are
  // eligible: a word that is only in the pool because it was answered once in
  // an open test is already known to the student and is not new material.
  const freshWords = [...new Set(fresh.map((f) => f.vocabularyId))]
    .filter((id) => intakeIds.has(id))
    .slice(0, newLimit)
  const freshSelected = fresh.filter((f) => freshWords.includes(f.vocabularyId))

  return [...due.slice(0, dueLimit), ...freshSelected]
}

/* ─────────────────────────── tests over a list ─────────────────────────── */

/**
 * Which words a test covers.
 *
 * `due` is the spaced-repetition queue and is what the student gets when they
 * just press start. The other three exist because the study book, the vault and
 * the map are lists a student looks at and then wants to be tested on — a test
 * you cannot aim at the list in front of you is a different product.
 */
export type QueueScope = 'due' | 'all' | 'saved' | 'wrong'

export function parseQueueScope(value: string | undefined): QueueScope {
  return value === 'all' || value === 'saved' || value === 'wrong' ? value : 'due'
}

export function parseDirections(value: string | undefined): Direction[] {
  if (value === 'en_ko' || value === 'ko_en') return [value]
  return DIRECTIONS
}

/** Words per test when the student aims one at a list. Two directions each. */
const SCOPED_WORD_LIMIT = 25

/**
 * Builds a test over an arbitrary list.
 *
 * Unlike the daily queue this ignores due dates: the student asked for these
 * words, and telling them "nothing is due" when they are staring at the list
 * they want to drill would be answering a question they did not ask. Answers
 * still feed FSRS, so an early review is not wasted — it just is not scheduled.
 */
export async function buildScopedQueue(
  userId: string,
  opts: {
    scope: QueueScope
    setId?: string
    /** Test the words that belong to no set. Mirrors the shelf's last row. */
    unassigned?: boolean
    directions?: Direction[]
    wordLimit?: number
    now?: Date
  },
  db: Db = defaultDb,
): Promise<QueueItem[]> {
  if (opts.scope === 'due') {
    const queue = await buildTodayQueue(userId, { now: opts.now }, db)
    const directions = opts.directions ?? DIRECTIONS
    return queue.filter((item) => directions.includes(item.direction))
  }

  const now = opts.now ?? new Date()
  const directions = opts.directions ?? DIRECTIONS
  const ids = await scopeIds(userId, opts.scope, opts.setId, opts.unassigned ?? false, db)
  if (!ids.length) return []

  const rows = await db
    .select({
      vocabularyId: vocabularies.id,
      lemma: vocabularies.lemma,
      translation: vocabularyTranslations.text,
      direction: userVocabularyCards.direction,
    })
    .from(vocabularies)
    .innerJoin(
      vocabularyTranslations,
      and(
        eq(vocabularyTranslations.vocabularyId, vocabularies.id),
        eq(vocabularyTranslations.isPrimary, true),
      ),
    )
    .leftJoin(
      userVocabularyCards,
      and(
        eq(userVocabularyCards.vocabularyId, vocabularies.id),
        eq(userVocabularyCards.userId, userId),
      ),
    )
    .where(inArray(vocabularies.id, ids))
    .orderBy(asc(vocabularies.lemma))

  const words = new Map<string, { lemma: string; translation: string; started: Set<Direction> }>()
  for (const row of rows) {
    const entry = words.get(row.vocabularyId) ?? {
      lemma: row.lemma,
      translation: row.translation,
      started: new Set<Direction>(),
    }
    if (row.direction) entry.started.add(row.direction)
    words.set(row.vocabularyId, entry)
  }

  const items: QueueItem[] = []
  for (const [vocabularyId, info] of [...words].slice(0, opts.wordLimit ?? SCOPED_WORD_LIMIT)) {
    for (const direction of directions) {
      items.push({
        vocabularyId,
        lemma: info.lemma,
        translation: info.translation,
        direction,
        isNew: !info.started.has(direction),
        dueAt: now,
      })
    }
  }
  return items
}

async function scopeIds(
  userId: string,
  scope: Exclude<QueueScope, 'due'>,
  setId: string | undefined,
  unassigned: boolean,
  db: Db,
): Promise<string[]> {
  if (scope === 'saved') {
    const rows = await db
      .select({ id: userVocabularyState.vocabularyId })
      .from(userVocabularyState)
      .where(
        and(
          eq(userVocabularyState.userId, userId),
          sql`${userVocabularyState.bookmarkedAt} is not null`,
        ),
      )
    return rows.map((r) => r.id)
  }

  if (scope === 'wrong') {
    const rows = await db
      .selectDistinct({ id: reviewEvents.vocabularyId })
      .from(reviewEvents)
      .where(and(eq(reviewEvents.userId, userId), eq(reviewEvents.correct, false)))
    return rows.map((r) => r.id)
  }

  const rows = await db
    .select({ id: vocabularies.id })
    .from(vocabularies)
    .where(scopeWhere(setId, unassigned, db))
    .orderBy(asc(vocabularies.lemma))
  return rows.map((r) => r.id)
}

function scopeWhere(setId: string | undefined, unassigned: boolean, db: Db) {
  if (setId) {
    return inArray(
      vocabularies.id,
      db
        .select({ id: vocabularySetItems.vocabularyId })
        .from(vocabularySetItems)
        .where(eq(vocabularySetItems.setId, setId)),
    )
  }
  if (unassigned) {
    return sql`not exists (
      select 1 from ${vocabularySetItems} i where i.vocabulary_id = ${vocabularies.id}
    )`
  }
  return sql`true`
}

/**
 * The three numbers at the top of the study book.
 *
 * Counted in SQL rather than by building the day's queue and measuring it. The
 * queue is five reads and a join over every word in the pool — an expensive way
 * to learn two numbers, and it ran before the shelf could even start loading.
 *
 * The caps mirror `buildTodayQueue` so the headline matches the button: the
 * queue takes at most `dueLimit` due cards and introduces at most `newLimit`
 * unseen words, both directions each.
 */
export async function getTodaySummary(
  userId: string,
  opts: { now?: Date; newLimit?: number; dueLimit?: number } = {},
  db: Db = defaultDb,
): Promise<TodaySummary> {
  const now = opts.now ?? new Date()
  const newLimit = opts.newLimit ?? DEFAULT_NEW_PER_DAY
  const dueLimit = opts.dueLimit ?? DEFAULT_DUE_LIMIT

  const rows = await db.execute<{ due: number; fresh: number; recommended: number }>(sql`
    with intake as (
      select vocabulary_id from user_vocabulary_state
        where user_id = ${userId} and bookmarked_at is not null
      union
      select i.vocabulary_id from assignments a
        join vocabulary_set_items i on i.set_id = a.set_id
        where a.student_id = ${userId}
    ),
    -- A word only enters a session once it has something to be asked about.
    teachable as (
      select k.vocabulary_id from intake k
        where exists (
          select 1 from vocabulary_translations t where t.vocabulary_id = k.vocabulary_id
        )
    ),
    fresh as (
      select 2 - count(c.*) as missing
        from teachable k
        left join user_vocabulary_cards c
          on c.vocabulary_id = k.vocabulary_id and c.user_id = ${userId}
        group by k.vocabulary_id
        having 2 - count(c.*) > 0
        limit ${newLimit}
    )
    select
      least(
        (select count(*) from user_vocabulary_cards
          where user_id = ${userId} and due_at <= ${now.toISOString()}::timestamptz),
        ${dueLimit}
      )::int as due,
      (select coalesce(sum(missing), 0) from fresh)::int as fresh,
      (select count(*) from user_vocabulary_state
        where user_id = ${userId} and ${isOutstandingRecommendation()})::int as recommended
  `)

  const row = (rows as unknown as Array<{ due: number; fresh: number; recommended: number }>)[0]
  return {
    dueCount: Number(row?.due ?? 0),
    newCount: Number(row?.fresh ?? 0),
    recommendedCount: Number(row?.recommended ?? 0),
  }
}

/* ─────────────────────────── recording answers ─────────────────────────── */

/**
 * A recommendation is outstanding until the student opens the map *after* it
 * was made. Browsing a word before it was ever recommended must not silence the
 * recommendation that follows.
 */
export function isOutstandingRecommendation() {
  return sql`${userVocabularyState.brainMapRecommendedAt} is not null
    and (
      ${userVocabularyState.brainMapOpenedAt} is null
      or ${userVocabularyState.brainMapOpenedAt} < ${userVocabularyState.brainMapRecommendedAt}
    )`
}

export type RecallAnswer = {
  userId: string
  vocabularyId: string
  direction: Direction
  correct: boolean
  responseTimeMs?: number | null
  questionType?: 'recall_choice' | 'recall_typed'
  payload?: Record<string, unknown>
  now?: Date
}

export type RecallOutcome = {
  nextDueAt: Date
  estimatedRetention: number
  band: ReturnType<typeof retentionBand>
  brainMapRecommended: boolean
  recommendationMessage: string | null
}

/**
 * The write path for a single recall answer: log the event, advance the FSRS
 * card, then re-evaluate whether this word has earned a Brain Map.
 *
 * The event log is written first and is never derived from the card, so the
 * card can always be recomputed from history if the algorithm changes.
 */
export async function recordRecallAnswer(
  answer: RecallAnswer,
  db: Db = defaultDb,
): Promise<RecallOutcome> {
  const now = answer.now ?? new Date()

  return db.transaction(async (tx) => {
    await tx.insert(reviewEvents).values({
      userId: answer.userId,
      vocabularyId: answer.vocabularyId,
      direction: answer.direction,
      questionType: answer.questionType ?? 'recall_choice',
      correct: answer.correct,
      responseTimeMs: answer.responseTimeMs ?? null,
      payload: answer.payload ?? null,
      reviewedAt: now,
    })

    const [existing] = await tx
      .select()
      .from(userVocabularyCards)
      .where(
        and(
          eq(userVocabularyCards.userId, answer.userId),
          eq(userVocabularyCards.vocabularyId, answer.vocabularyId),
          eq(userVocabularyCards.direction, answer.direction),
        ),
      )
      .limit(1)

    const current: CardState = existing
      ? {
          stability: existing.stability,
          difficulty: existing.difficulty,
          fsrsState: existing.fsrsState,
          dueAt: existing.dueAt,
          lastReviewedAt: existing.lastReviewedAt,
          elapsedDays: existing.elapsedDays,
          scheduledDays: existing.scheduledDays,
          learningSteps: existing.learningSteps,
          reps: existing.reps,
          lapses: existing.lapses,
          consecutiveCorrect: existing.consecutiveCorrect,
        }
      : emptyCardState(now)

    const { next } = advanceCard(current, answer, now)

    await tx
      .insert(userVocabularyCards)
      .values({
        userId: answer.userId,
        vocabularyId: answer.vocabularyId,
        direction: answer.direction,
        stability: next.stability,
        difficulty: next.difficulty,
        fsrsState: next.fsrsState,
        dueAt: next.dueAt,
        lastReviewedAt: next.lastReviewedAt,
        elapsedDays: next.elapsedDays,
        scheduledDays: next.scheduledDays,
        learningSteps: next.learningSteps,
        reps: next.reps,
        lapses: next.lapses,
        consecutiveCorrect: next.consecutiveCorrect,
      })
      .onConflictDoUpdate({
        target: [
          userVocabularyCards.userId,
          userVocabularyCards.vocabularyId,
          userVocabularyCards.direction,
        ],
        set: {
          stability: next.stability,
          difficulty: next.difficulty,
          fsrsState: next.fsrsState,
          dueAt: next.dueAt,
          lastReviewedAt: next.lastReviewedAt,
          elapsedDays: next.elapsedDays,
          scheduledDays: next.scheduledDays,
          learningSteps: next.learningSteps,
          reps: next.reps,
          lapses: next.lapses,
          consecutiveCorrect: next.consecutiveCorrect,
        },
      })

    await tx
      .insert(userVocabularyState)
      .values({ userId: answer.userId, vocabularyId: answer.vocabularyId })
      .onConflictDoNothing()

    const recommendation = await refreshRecommendation(
      answer.userId,
      answer.vocabularyId,
      now,
      tx as unknown as Db,
    )

    const retention = estimatedRetention(next, now)
    return {
      nextDueAt: next.dueAt,
      estimatedRetention: retention,
      band: retentionBand(retention),
      brainMapRecommended: recommendation.recommend,
      recommendationMessage: recommendation.message,
    }
  })
}

/** Records a graded answer from inside a Brain Map node. */
export async function recordNodeAnswer(
  input: {
    userId: string
    vocabularyId: string
    node: NodeType
    questionType:
      | 'sentence_translation'
      | 'similar_battle'
      | 'collocation_cloze'
      | 'word_family_cloze'
    correct: boolean
    responseTimeMs?: number | null
    pairId?: string | null
    payload?: Record<string, unknown>
    now?: Date
  },
  db: Db = defaultDb,
): Promise<{ nodeStatus: ReturnType<typeof deriveNodeStatus> }> {
  const now = input.now ?? new Date()

  return db.transaction(async (tx) => {
    await tx.insert(reviewEvents).values({
      userId: input.userId,
      vocabularyId: input.vocabularyId,
      questionType: input.questionType,
      nodeType: input.node,
      correct: input.correct,
      responseTimeMs: input.responseTimeMs ?? null,
      payload: { ...(input.payload ?? {}), pairId: input.pairId ?? null },
      reviewedAt: now,
    })

    const [progress] = await tx
      .insert(brainMapNodeProgress)
      .values({
        userId: input.userId,
        vocabularyId: input.vocabularyId,
        node: input.node,
        attempts: 1,
        correct: input.correct ? 1 : 0,
        lastStudiedAt: now,
        status: 'learning',
      })
      .onConflictDoUpdate({
        target: [
          brainMapNodeProgress.userId,
          brainMapNodeProgress.vocabularyId,
          brainMapNodeProgress.node,
        ],
        set: {
          attempts: sql`${brainMapNodeProgress.attempts} + 1`,
          correct: sql`${brainMapNodeProgress.correct} + ${input.correct ? 1 : 0}`,
          lastStudiedAt: now,
          updatedAt: now,
        },
      })
      .returning()

    if (!progress) throw new Error('Failed to record node progress')

    const status = deriveNodeStatus({
      attempts: progress.attempts,
      correct: progress.correct,
      available: true,
    })

    await tx
      .update(brainMapNodeProgress)
      .set({ status })
      .where(
        and(
          eq(brainMapNodeProgress.userId, input.userId),
          eq(brainMapNodeProgress.vocabularyId, input.vocabularyId),
          eq(brainMapNodeProgress.node, input.node),
        ),
      )

    // A confusion is a property of this student, not of the pair: two students
    // mix up different things, and the teacher view depends on that being true.
    if (input.pairId) {
      await tx
        .insert(userConfusions)
        .values({
          userId: input.userId,
          pairId: input.pairId,
          wrongCount: input.correct ? 0 : 1,
          rightCount: input.correct ? 1 : 0,
          lastWrongAt: input.correct ? null : now,
        })
        .onConflictDoUpdate({
          target: [userConfusions.userId, userConfusions.pairId],
          set: {
            wrongCount: sql`${userConfusions.wrongCount} + ${input.correct ? 0 : 1}`,
            rightCount: sql`${userConfusions.rightCount} + ${input.correct ? 1 : 0}`,
            lastWrongAt: input.correct ? userConfusions.lastWrongAt : now,
            updatedAt: now,
          },
        })
    }

    await refreshRecommendation(input.userId, input.vocabularyId, now, tx as unknown as Db)
    return { nodeStatus: status }
  })
}

export async function logLearningEvent(
  input: { userId: string; vocabularyId?: string | null; kind: string; payload?: Record<string, unknown> },
  db: Db = defaultDb,
): Promise<void> {
  await db.insert(learningEvents).values({
    userId: input.userId,
    vocabularyId: input.vocabularyId ?? null,
    kind: input.kind,
    payload: input.payload ?? null,
  })
}

/* ───────────────────────── recommendation engine ───────────────────────── */

const RECENT_WINDOW = 8

/**
 * One read of everything this student's state for one word.
 *
 * The word page renders the personal map and the semantic map together, and
 * both need the same rows. Reading them once and handing the result around
 * turned twelve round trips into four.
 */
export type WordStateRead = {
  signals: WordSignals
  cards: Array<typeof userVocabularyCards.$inferSelect>
  state: (typeof userVocabularyState.$inferSelect) | null
}

/** Alias kept for callers that only care about the derived signals. */
export type WordSignalsRead = WordStateRead

export async function collectWordSignals(
  userId: string,
  vocabularyId: string,
  db: Db = defaultDb,
): Promise<WordSignals> {
  return (await collectWordState(userId, vocabularyId, db)).signals
}

export async function collectWordState(
  userId: string,
  vocabularyId: string,
  db: Db = defaultDb,
): Promise<WordStateRead> {
  const [cards, recent, nodeErrors, state] = await Promise.all([
    db
      .select()
      .from(userVocabularyCards)
      .where(
        and(
          eq(userVocabularyCards.userId, userId),
          eq(userVocabularyCards.vocabularyId, vocabularyId),
        ),
      ),
    db
      .select({ correct: reviewEvents.correct })
      .from(reviewEvents)
      .where(
        and(
          eq(reviewEvents.userId, userId),
          eq(reviewEvents.vocabularyId, vocabularyId),
          inArray(reviewEvents.questionType, ['recall_choice', 'recall_typed']),
        ),
      )
      .orderBy(desc(reviewEvents.reviewedAt))
      .limit(RECENT_WINDOW),
    db
      .select({ questionType: reviewEvents.questionType, value: count() })
      .from(reviewEvents)
      .where(
        and(
          eq(reviewEvents.userId, userId),
          eq(reviewEvents.vocabularyId, vocabularyId),
          eq(reviewEvents.correct, false),
        ),
      )
      .groupBy(reviewEvents.questionType),
    db
      .select()
      .from(userVocabularyState)
      .where(
        and(
          eq(userVocabularyState.userId, userId),
          eq(userVocabularyState.vocabularyId, vocabularyId),
        ),
      )
      .limit(1),
  ])

  const now = new Date()
  const errorsOf = (type: string) =>
    nodeErrors.find((e) => e.questionType === type)?.value ?? 0

  const retentions = cards.map((c) =>
    estimatedRetention(
      {
        stability: c.stability,
        difficulty: c.difficulty,
        fsrsState: c.fsrsState,
        dueAt: c.dueAt,
        lastReviewedAt: c.lastReviewedAt,
        elapsedDays: c.elapsedDays,
        scheduledDays: c.scheduledDays,
        learningSteps: c.learningSteps,
        reps: c.reps,
        lapses: c.lapses,
        consecutiveCorrect: c.consecutiveCorrect,
      },
      now,
    ),
  )

  return {
    signals: {
      lapses: cards.reduce((sum, c) => sum + c.lapses, 0),
      reps: cards.reduce((sum, c) => sum + c.reps, 0),
      recentCorrect: recent.filter((r) => r.correct).length,
      recentAttempts: recent.length,
      minRetention: retentions.length ? Math.min(...retentions) : 0,
      confusionErrors: errorsOf('similar_battle'),
      sentenceErrors: errorsOf('sentence_translation'),
      collocationErrors: errorsOf('collocation_cloze'),
      markedImportant: state[0]?.isImportant ?? false,
      importantReason: state[0]?.importantReason ?? null,
    },
    cards,
    state: state[0] ?? null,
  }
}

async function refreshRecommendation(
  userId: string,
  vocabularyId: string,
  now: Date,
  db: Db,
) {
  const signals = await collectWordSignals(userId, vocabularyId, db)
  const recommendation = classifyWord(signals)

  await db
    .insert(userVocabularyState)
    .values({
      userId,
      vocabularyId,
      brainMapRecommendedAt: recommendation.recommend ? now : null,
    })
    .onConflictDoUpdate({
      target: [userVocabularyState.userId, userVocabularyState.vocabularyId],
      set: {
        // Sticky: once recommended, the suggestion stands until the student
        // opens the map. Flapping recommendations are worse than none.
        brainMapRecommendedAt: recommendation.recommend
          ? sql`coalesce(${userVocabularyState.brainMapRecommendedAt}, ${now.toISOString()}::timestamptz)`
          : userVocabularyState.brainMapRecommendedAt,
        updatedAt: now,
      },
    })

  return recommendation
}

export async function markImportant(
  input: {
    userId: string
    vocabularyId: string
    important: boolean
    reason: 'teacher_selected' | 'student_selected' | 'exam'
    markedBy: string
  },
  db: Db = defaultDb,
): Promise<void> {
  const now = new Date()
  await db
    .insert(userVocabularyState)
    .values({
      userId: input.userId,
      vocabularyId: input.vocabularyId,
      isImportant: input.important,
      importantReason: input.important ? input.reason : null,
      markedBy: input.markedBy,
      brainMapRecommendedAt: input.important ? now : null,
    })
    .onConflictDoUpdate({
      target: [userVocabularyState.userId, userVocabularyState.vocabularyId],
      set: {
        isImportant: input.important,
        importantReason: input.important ? input.reason : null,
        markedBy: input.markedBy,
        brainMapRecommendedAt: input.important
          ? sql`coalesce(${userVocabularyState.brainMapRecommendedAt}, ${now.toISOString()}::timestamptz)`
          : null,
        updatedAt: now,
      },
    })
}
