import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { reviewEvents, userVocabularyCards, userVocabularyState } from '@/lib/db/schema'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { addToSet, assignSet, createSet } from '@/lib/data/teacher'
import {
  buildTodayQueue,
  getTodaySummary,
  bookmarkedIds,
  markImportant,
  recordNodeAnswer,
  recordRecallAnswer,
  toggleBookmark,
} from '@/lib/data/study'
import {
  getPersonalBrainMap,
  listRecommendedWords,
  markBrainMapOpened,
} from '@/lib/data/personal'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

async function scenario(words = ['maintain', 'affect', 'issue']) {
  const teacher = await createUser('teacher')
  const student = await createUser('student')
  const ids: string[] = []
  for (const lemma of words) {
    const { id } = await findOrCreateVocabulary({
      lemma,
      partOfSpeech: 'verb',
      translations: [`${lemma}-뜻`],
    })
    ids.push(id)
  }
  const setId = await createSet({ ownerId: teacher.id, title: 'test set' })
  await addToSet(setId, ids)
  await assignSet({ setId, studentId: student.id, assignedBy: teacher.id })
  return { teacher, student, ids, setId }
}

describe.skipIf(!hasDatabase)('daily queue', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('offers nothing to a student with no assignment', async () => {
    const student = await createUser('student')
    expect(await buildTodayQueue(student.id)).toEqual([])
  })

  it('introduces both recall directions for a new word', async () => {
    const { student, ids } = await scenario(['maintain'])
    const queue = await buildTodayQueue(student.id)
    expect(queue).toHaveLength(2)
    expect(queue.map((q) => q.direction).sort()).toEqual(['en_ko', 'ko_en'])
    expect(queue.every((q) => q.isNew && q.vocabularyId === ids[0])).toBe(true)
  })

  it('throttles how many new words enter one session', async () => {
    const { student } = await scenario(['maintain', 'affect', 'issue'])
    const queue = await buildTodayQueue(student.id, { newLimit: 2 })
    expect(new Set(queue.map((q) => q.vocabularyId)).size).toBe(2)
  })

  it('drops an answered card out of the queue until it comes due again', async () => {
    const { student, ids } = await scenario(['maintain'])
    const now = new Date('2026-03-01T09:00:00Z')

    await recordRecallAnswer({
      userId: student.id,
      vocabularyId: ids[0]!,
      direction: 'en_ko',
      correct: true,
      responseTimeMs: 2000,
      now,
    })

    const soon = await buildTodayQueue(student.id, { now })
    expect(soon.some((q) => q.direction === 'en_ko' && !q.isNew)).toBe(false)

    const muchLater = new Date('2027-03-01T09:00:00Z')
    const due = await buildTodayQueue(student.id, { now: muchLater })
    expect(due.some((q) => q.direction === 'en_ko' && !q.isNew)).toBe(true)
  })

  it('counts due, new and recommended words for the home screen', async () => {
    const { student, ids } = await scenario(['maintain', 'affect'])
    const summary = await getTodaySummary(student.id)
    expect(summary.newCount).toBe(4)
    expect(summary.dueCount).toBe(0)

    await markImportant({
      userId: student.id,
      vocabularyId: ids[0]!,
      important: true,
      reason: 'teacher_selected',
      markedBy: student.id,
    })
    expect((await getTodaySummary(student.id)).recommendedCount).toBe(1)
  })
})

describe.skipIf(!hasDatabase)('recording answers', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('writes an event and a card for every answer', async () => {
    const { student, ids } = await scenario(['maintain'])
    await recordRecallAnswer({
      userId: student.id,
      vocabularyId: ids[0]!,
      direction: 'en_ko',
      correct: true,
      responseTimeMs: 1500,
      questionType: 'recall_typed',
    })

    const events = await db.select().from(reviewEvents).where(eq(reviewEvents.userId, student.id))
    expect(events).toHaveLength(1)
    expect(events[0]!.questionType).toBe('recall_typed')
    expect(events[0]!.responseTimeMs).toBe(1500)

    const cards = await db
      .select()
      .from(userVocabularyCards)
      .where(eq(userVocabularyCards.userId, student.id))
    expect(cards).toHaveLength(1)
    expect(cards[0]!.reps).toBe(1)
    expect(cards[0]!.dueAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('keeps the two directions on independent schedules', async () => {
    const { student, ids } = await scenario(['maintain'])
    const now = new Date('2026-03-01T09:00:00Z')

    await recordRecallAnswer({ userId: student.id, vocabularyId: ids[0]!, direction: 'en_ko', correct: true, now })
    await recordRecallAnswer({ userId: student.id, vocabularyId: ids[0]!, direction: 'ko_en', correct: false, now })

    const cards = await db
      .select()
      .from(userVocabularyCards)
      .where(eq(userVocabularyCards.userId, student.id))
    expect(cards).toHaveLength(2)

    const enKo = cards.find((c) => c.direction === 'en_ko')!
    const koEn = cards.find((c) => c.direction === 'ko_en')!
    expect(enKo.consecutiveCorrect).toBe(1)
    expect(koEn.consecutiveCorrect).toBe(0)
    expect(enKo.dueAt.getTime()).toBeGreaterThan(koEn.dueAt.getTime())
  })

  it('recommends a brain map after repeated failures on the same word', async () => {
    const { student, ids } = await scenario(['maintain'])
    let now = new Date('2026-03-01T09:00:00Z')
    let last

    for (let i = 0; i < 5; i += 1) {
      last = await recordRecallAnswer({
        userId: student.id,
        vocabularyId: ids[0]!,
        direction: 'en_ko',
        correct: false,
        now,
      })
      now = new Date(now.getTime() + 86_400_000)
    }

    expect(last!.brainMapRecommended).toBe(true)
    expect(last!.recommendationMessage).toBeTruthy()

    const recommended = await listRecommendedWords(student.id)
    expect(recommended.map((r) => r.vocabularyId)).toContain(ids[0])
  })

  it('does not recommend a brain map for a word the student answers correctly', async () => {
    const { student, ids } = await scenario(['maintain'])
    let now = new Date('2026-03-01T09:00:00Z')
    let last
    for (let i = 0; i < 5; i += 1) {
      last = await recordRecallAnswer({
        userId: student.id,
        vocabularyId: ids[0]!,
        direction: 'en_ko',
        correct: true,
        responseTimeMs: 1200,
        now,
      })
      now = new Date(now.getTime() + 3 * 86_400_000)
    }
    expect(last!.brainMapRecommended).toBe(false)
  })

  it('tracks node progress and per-student confusion separately', async () => {
    const { student, ids } = await scenario(['maintain'])

    const first = await recordNodeAnswer({
      userId: student.id,
      vocabularyId: ids[0]!,
      node: 'sentences',
      questionType: 'sentence_translation',
      correct: false,
    })
    expect(first.nodeStatus).toBe('weak')

    for (let i = 0; i < 4; i += 1) {
      await recordNodeAnswer({
        userId: student.id,
        vocabularyId: ids[0]!,
        node: 'sentences',
        questionType: 'sentence_translation',
        correct: true,
      })
    }

    const personal = await getPersonalBrainMap(student.id, ids[0]!)
    expect(personal!.nodes.find((n) => n.node === 'sentences')!.status).toBe('mastered')
    expect(personal!.nodes.find((n) => n.node === 'collocations')!.attempts).toBe(0)
  })
})

describe.skipIf(!hasDatabase)('personal state isolation', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('never lets one student read or affect another student’s state', async () => {
    const teacher = await createUser('teacher')
    const alice = await createUser('student')
    const bob = await createUser('student')

    const { id } = await findOrCreateVocabulary({
      lemma: 'maintain',
      partOfSpeech: 'verb',
      translations: ['유지하다'],
    })
    const setId = await createSet({ ownerId: teacher.id, title: 'shared set' })
    await addToSet(setId, [id])
    await assignSet({ setId, studentId: alice.id, assignedBy: teacher.id })
    await assignSet({ setId, studentId: bob.id, assignedBy: teacher.id })

    const now = new Date('2026-03-01T09:00:00Z')
    await recordRecallAnswer({ userId: alice.id, vocabularyId: id, direction: 'en_ko', correct: false, now })
    await recordRecallAnswer({ userId: bob.id, vocabularyId: id, direction: 'en_ko', correct: true, responseTimeMs: 900, now })

    const alicePersonal = await getPersonalBrainMap(alice.id, id)
    const bobPersonal = await getPersonalBrainMap(bob.id, id)

    // Same master word, two different pictures of knowing it.
    const aliceEnKo = alicePersonal!.directions.find((d) => d.direction === 'en_ko')!
    const bobEnKo = bobPersonal!.directions.find((d) => d.direction === 'en_ko')!
    expect(aliceEnKo.reps).toBe(1)
    expect(bobEnKo.reps).toBe(1)
    expect(aliceEnKo.retention).toBeLessThan(bobEnKo.retention)
    expect(bobEnKo.dueAt!.getTime()).toBeGreaterThan(aliceEnKo.dueAt!.getTime())

    expect(
      await db.select().from(userVocabularyCards).where(eq(userVocabularyCards.userId, alice.id)),
    ).toHaveLength(1)
  })

  it('scopes a marked-important flag to one student', async () => {
    const { student, ids } = await scenario(['maintain'])
    const other = await createUser('student')

    await markImportant({
      userId: student.id,
      vocabularyId: ids[0]!,
      important: true,
      reason: 'student_selected',
      markedBy: student.id,
    })

    const mine = await db
      .select()
      .from(userVocabularyState)
      .where(
        and(
          eq(userVocabularyState.userId, student.id),
          eq(userVocabularyState.vocabularyId, ids[0]!),
        ),
      )
    expect(mine[0]!.isImportant).toBe(true)

    expect(
      await db.select().from(userVocabularyState).where(eq(userVocabularyState.userId, other.id)),
    ).toHaveLength(0)
  })
})

describe.skipIf(!hasDatabase)('recommendation lifecycle', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('keeps a recommendation outstanding when the map was browsed beforehand', async () => {
    const { student, ids } = await scenario(['maintain'])

    // The student browses the word first — out of curiosity, before anything
    // has gone wrong with it.
    await markBrainMapOpened(student.id, ids[0]!)
    expect((await getTodaySummary(student.id)).recommendedCount).toBe(0)

    // Only afterwards does a teacher flag it.
    await markImportant({
      userId: student.id,
      vocabularyId: ids[0]!,
      important: true,
      reason: 'teacher_selected',
      markedBy: student.id,
    })

    // The earlier visit must not swallow the new recommendation.
    expect((await getTodaySummary(student.id)).recommendedCount).toBe(1)
    expect((await listRecommendedWords(student.id)).map((r) => r.vocabularyId)).toContain(ids[0])
  })

  it('clears the recommendation once the student opens the map', async () => {
    const { student, ids } = await scenario(['maintain'])
    await markImportant({
      userId: student.id,
      vocabularyId: ids[0]!,
      important: true,
      reason: 'student_selected',
      markedBy: student.id,
    })
    expect((await getTodaySummary(student.id)).recommendedCount).toBe(1)

    await markBrainMapOpened(student.id, ids[0]!)
    expect((await getTodaySummary(student.id)).recommendedCount).toBe(0)
    expect(await listRecommendedWords(student.id)).toEqual([])
  })
})

describe.skipIf(!hasDatabase)('bookmarks as the study list', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function library(lemmas: string[]) {
    const student = await createUser('student')
    const ids: string[] = []
    for (const lemma of lemmas) {
      const { id } = await findOrCreateVocabulary({
        lemma,
        partOfSpeech: 'verb',
        translations: [`${lemma}-뜻`],
      })
      ids.push(id)
    }
    return { student, ids }
  }

  it('studies nothing until something is bookmarked', async () => {
    // The library is fully browsable, but browsing is not studying.
    const { student } = await library(['maintain', 'affect'])
    expect(await buildTodayQueue(student.id)).toEqual([])
  })

  it('puts a bookmarked word into the queue without any assignment', async () => {
    const { student, ids } = await library(['maintain', 'affect'])
    await toggleBookmark({ userId: student.id, vocabularyId: ids[0]!, bookmarked: true })

    const queue = await buildTodayQueue(student.id)
    expect(new Set(queue.map((q) => q.vocabularyId))).toEqual(new Set([ids[0]]))
    expect(queue).toHaveLength(2) // both recall directions
  })

  it('takes a word back out when the bookmark is removed', async () => {
    const { student, ids } = await library(['maintain'])
    await toggleBookmark({ userId: student.id, vocabularyId: ids[0]!, bookmarked: true })
    expect(await buildTodayQueue(student.id)).toHaveLength(2)

    await toggleBookmark({ userId: student.id, vocabularyId: ids[0]!, bookmarked: false })
    expect(await buildTodayQueue(student.id)).toEqual([])
  })

  it('still honours a teacher assignment alongside bookmarks', async () => {
    const teacher = await createUser('teacher')
    const { student, ids } = await library(['maintain', 'affect', 'issue'])

    const setId = await createSet({ ownerId: teacher.id, title: '과외 단어' })
    await addToSet(setId, [ids[0]!])
    await assignSet({ setId, studentId: student.id, assignedBy: teacher.id })
    await toggleBookmark({ userId: student.id, vocabularyId: ids[1]!, bookmarked: true })

    const queue = await buildTodayQueue(student.id)
    expect(new Set(queue.map((q) => q.vocabularyId))).toEqual(new Set([ids[0], ids[1]]))
  })

  it('keeps one person’s bookmarks out of another’s queue', async () => {
    const { student, ids } = await library(['maintain'])
    const other = await createUser('student')
    await toggleBookmark({ userId: student.id, vocabularyId: ids[0]!, bookmarked: true })

    expect(await buildTodayQueue(student.id)).toHaveLength(2)
    expect(await buildTodayQueue(other.id)).toEqual([])
    expect(await bookmarkedIds(other.id, ids)).toEqual(new Set())
  })

  it('does not ask for a Brain Map just because a word was bookmarked', async () => {
    // Marking a word important asks for its map immediately. A bookmark must
    // not, or every pick would demand one and the recommendation stops meaning
    // anything.
    const { student, ids } = await library(['maintain'])
    await toggleBookmark({ userId: student.id, vocabularyId: ids[0]!, bookmarked: true })

    expect((await getTodaySummary(student.id)).recommendedCount).toBe(0)

    await markImportant({
      userId: student.id,
      vocabularyId: ids[0]!,
      important: true,
      reason: 'teacher_selected',
      markedBy: student.id,
    })
    expect((await getTodaySummary(student.id)).recommendedCount).toBe(1)
  })
})
