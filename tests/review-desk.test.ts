import { and, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { userVocabularyCards } from '@/lib/db/schema'
import { dueLabel, listReviewWords, reviewCounts } from '@/lib/data/review'
import { recordRecallAnswer } from '@/lib/data/study'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

/**
 * 보관함 as the review desk.
 *
 * The screen's whole claim is that it shows the forgetting curve rather than
 * another word list, so what is worth testing is the schedule: which bucket a
 * word falls in, that a word appears once rather than once per direction, and
 * that "how much is left" is taken from the weaker of its two cards.
 */
describe.skipIf(!hasDatabase)('the review desk', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function aWord(lemma: string, teacherId: string) {
    const { id } = await findOrCreateVocabulary({
      lemma,
      translations: [`${lemma} 뜻`],
      createdBy: teacherId,
    })
    return id
  }

  /** Answers both directions, then puts the card where the test needs it. */
  async function answered(
    studentId: string,
    vocabularyId: string,
    opts: { correct?: boolean; dueAt?: Date } = {},
  ) {
    for (const direction of ['en_ko', 'ko_en'] as const) {
      await recordRecallAnswer({
        userId: studentId,
        vocabularyId,
        direction,
        correct: opts.correct ?? true,
        responseTimeMs: 1200,
        questionType: 'recall_choice',
      })
    }
    if (opts.dueAt) {
      await db
        .update(userVocabularyCards)
        .set({ dueAt: opts.dueAt })
        .where(
          and(
            eq(userVocabularyCards.userId, studentId),
            eq(userVocabularyCards.vocabularyId, vocabularyId),
          ),
        )
    }
  }

  it('splits words into due, upcoming and wrong', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const now = new Date()
    const overdue = await aWord('govern', teacher.id)
    const later = await aWord('impulse', teacher.id)
    const missed = await aWord('deceit', teacher.id)

    await answered(student.id, overdue, {
      dueAt: new Date(now.getTime() - 86_400_000),
    })
    await answered(student.id, later, {
      dueAt: new Date(now.getTime() + 3 * 86_400_000),
    })
    await answered(student.id, missed, {
      correct: false,
      dueAt: new Date(now.getTime() + 3 * 86_400_000),
    })

    const counts = await reviewCounts(student.id, { now })
    expect(counts.now).toBe(1)
    expect(counts.upcoming).toBe(2)
    expect(counts.wrong).toBe(1)
  })

  it('lists a word once however many directions it has', async () => {
    // A word owns two cards. Counting rows would show every word twice and
    // report a five-word backlog as ten.
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const now = new Date()
    const word = await aWord('assert', teacher.id)
    await answered(student.id, word, {
      dueAt: new Date(now.getTime() - 3600_000),
    })

    const page = await listReviewWords({
      userId: student.id,
      bucket: 'now',
      now,
    })
    expect(page.total).toBe(1)
    expect(page.words).toHaveLength(1)
    expect(page.words[0]!.lemma).toBe('assert')
  })

  it('is due when its earlier card is due, not when both are', async () => {
    // Recognising a word and producing it drift apart. A student who can read
    // `scheme` but cannot write it has work to do today.
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const now = new Date()
    const word = await aWord('scheme', teacher.id)
    await answered(student.id, word, {
      dueAt: new Date(now.getTime() + 5 * 86_400_000),
    })
    await db
      .update(userVocabularyCards)
      .set({ dueAt: new Date(now.getTime() - 3600_000) })
      .where(
        and(
          eq(userVocabularyCards.userId, student.id),
          eq(userVocabularyCards.vocabularyId, word),
          eq(userVocabularyCards.direction, 'ko_en'),
        ),
      )

    const counts = await reviewCounts(student.id, { now })
    expect(counts.now).toBe(1)
    expect(counts.upcoming).toBe(0)

    const page = await listReviewWords({
      userId: student.id,
      bucket: 'now',
      now,
    })
    expect(page.words[0]!.lemma).toBe('scheme')
  })

  it('leads the due list with the most overdue word', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const now = new Date()
    const old = await aWord('aspire', teacher.id)
    const recent = await aWord('conversion', teacher.id)
    await answered(student.id, old, {
      dueAt: new Date(now.getTime() - 9 * 86_400_000),
    })
    await answered(student.id, recent, {
      dueAt: new Date(now.getTime() - 3600_000),
    })

    const page = await listReviewWords({
      userId: student.id,
      bucket: 'now',
      now,
    })
    expect(page.words.map((w) => w.lemma)).toEqual(['aspire', 'conversion'])
  })

  it('reports how much of the weaker direction is left', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const now = new Date()
    const word = await aWord('plausible', teacher.id)
    await answered(student.id, word)

    // One direction is left far behind its schedule; the other is fresh. The
    // desk has to report the one in trouble.
    await db
      .update(userVocabularyCards)
      .set({
        stability: 1,
        lastReviewedAt: new Date(now.getTime() - 60 * 86_400_000),
      })
      .where(
        and(
          eq(userVocabularyCards.userId, student.id),
          eq(userVocabularyCards.vocabularyId, word),
          eq(userVocabularyCards.direction, 'ko_en'),
        ),
      )
    await db
      .update(userVocabularyCards)
      .set({ dueAt: sql`now() - interval '1 hour'` })
      .where(
        and(eq(userVocabularyCards.userId, student.id), eq(userVocabularyCards.vocabularyId, word)),
      )

    const page = await listReviewWords({
      userId: student.id,
      bucket: 'now',
      now,
    })
    const retention = page.words[0]!.retention
    expect(retention).not.toBeNull()
    // The fresh direction on its own would still be near certain; what the desk
    // has to show is the half that has decayed.
    expect(retention!).toBeLessThan(0.8)
  })

  it('reports a word answered a moment ago as still known', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const now = new Date()
    const word = await aWord('adequate', teacher.id)
    await answered(student.id, word, {
      dueAt: new Date(now.getTime() - 60_000),
    })

    const page = await listReviewWords({
      userId: student.id,
      bucket: 'now',
      now,
    })
    expect(page.words[0]!.retention!).toBeGreaterThan(0.9)
  })

  it('keeps a wrong word in the mistake list even once it is scheduled ahead', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const now = new Date()
    const word = await aWord('disrupt', teacher.id)
    await answered(student.id, word, {
      correct: false,
      dueAt: new Date(now.getTime() + 4 * 86_400_000),
    })

    const upcoming = await listReviewWords({
      userId: student.id,
      bucket: 'upcoming',
      now,
    })
    expect(upcoming.words.map((w) => w.lemma)).toEqual(['disrupt'])

    const wrong = await listReviewWords({
      userId: student.id,
      bucket: 'wrong',
      now,
    })
    expect(wrong.words).toHaveLength(1)
    expect(wrong.words[0]!.wrongCount).toBe(2)
    expect(wrong.words[0]!.dueAt).not.toBeNull()
  })

  it('sees nothing that belongs to another student', async () => {
    const teacher = await createUser('teacher')
    const mine = await createUser('student')
    const theirs = await createUser('student')
    const now = new Date()
    const word = await aWord('legislation', teacher.id)
    await answered(theirs.id, word, {
      dueAt: new Date(now.getTime() - 86_400_000),
    })

    expect(await reviewCounts(mine.id, { now })).toEqual({
      now: 0,
      upcoming: 0,
      wrong: 0,
    })
    expect((await listReviewWords({ userId: mine.id, bucket: 'now', now })).words).toEqual([])
  })
})

describe('due labels', () => {
  const now = new Date('2026-03-01T09:00:00Z')

  it('says days, not hours', () => {
    expect(dueLabel(new Date('2026-03-02T09:00:00Z'), now)).toBe('내일')
    expect(dueLabel(new Date('2026-03-05T09:00:00Z'), now)).toBe('4일 후')
    expect(dueLabel(new Date('2026-05-30T09:00:00Z'), now)).toBe('3개월 후')
  })

  it('says a due word is due now rather than counting down to it', () => {
    expect(dueLabel(new Date('2026-03-01T12:00:00Z'), now)).toBe('지금')
    expect(dueLabel(new Date('2026-03-01T06:00:00Z'), now)).toBe('지금')
    expect(dueLabel(new Date('2026-02-25T09:00:00Z'), now)).toBe('4일 지남')
  })

  it('has something to say about a word that was never scheduled', () => {
    expect(dueLabel(null, now)).toBe('—')
  })
})
