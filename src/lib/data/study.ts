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
 * Words assigned to this student, in a stable order. Everything else in this
 * module is scoped through it, so a student can only ever study — and only ever
 * write state for — words that were actually assigned to them.
 */
function assignedVocabularyIds(userId: string, db: Db) {
  return db
    .selectDistinct({ id: vocabularySetItems.vocabularyId })
    .from(assignments)
    .innerJoin(vocabularySetItems, eq(vocabularySetItems.setId, assignments.setId))
    .where(eq(assignments.studentId, userId))
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

  const assigned = await assignedVocabularyIds(userId, db)
  const assignedIds = assigned.map((a) => a.id)
  if (!assignedIds.length) return []

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
    .where(inArray(vocabularies.id, assignedIds))
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
  // form and the meaning in the same sitting.
  const freshWords = [...new Set(fresh.map((f) => f.vocabularyId))].slice(0, newLimit)
  const freshSelected = fresh.filter((f) => freshWords.includes(f.vocabularyId))

  return [...due.slice(0, dueLimit), ...freshSelected]
}

export async function getTodaySummary(
  userId: string,
  opts: { now?: Date } = {},
  db: Db = defaultDb,
): Promise<TodaySummary> {
  const now = opts.now ?? new Date()
  const queue = await buildTodayQueue(userId, opts, db)

  const [recommended] = await db
    .select({ value: count() })
    .from(userVocabularyState)
    .where(and(eq(userVocabularyState.userId, userId), isOutstandingRecommendation()))

  return {
    dueCount: queue.filter((q) => !q.isNew && q.dueAt.getTime() <= now.getTime()).length,
    newCount: queue.filter((q) => q.isNew).length,
    recommendedCount: recommended?.value ?? 0,
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

export async function collectWordSignals(
  userId: string,
  vocabularyId: string,
  db: Db = defaultDb,
): Promise<WordSignals> {
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
