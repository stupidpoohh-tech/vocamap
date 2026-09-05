import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { reviewEvents } from '@/lib/db/schema'
import { agoKo, lastStudiedByStudent, studyLog } from '@/lib/data/study-log'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

/**
 * The tutor's check: did they sit down, and how did it go.
 *
 * The day boundary is the one both people in this app live by, so a session at
 * half past midnight Korean time is its own day — not the previous evening's,
 * and not UTC's.
 */
describe.skipIf(!hasDatabase)('a student’s study log', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function word(lemma: string, teacherId: string) {
    const { id } = await findOrCreateVocabulary({
      lemma,
      translations: [`${lemma} 뜻`],
      createdBy: teacherId,
    })
    return id
  }

  /** An answer at a wall-clock moment in Korea. */
  async function answered(userId: string, vocabularyId: string, at: string, correct: boolean) {
    await db.insert(reviewEvents).values({
      userId,
      vocabularyId,
      direction: 'en_ko',
      questionType: 'recall_choice',
      correct,
      reviewedAt: sql`${at}::timestamptz`,
    })
  }

  /** The Korean calendar day a given number of days back from now. */
  function koreanDay(daysAgo: number): string {
    return new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Seoul',
    })
  }

  /** Korean wall clock, a given number of days back from now. */
  function korean(daysAgo: number, hhmm: string): string {
    return `${koreanDay(daysAgo)} ${hhmm}+09`
  }

  it('gives one row per day, with how much and how right', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const govern = await word('govern', teacher.id)
    const impulse = await word('impulse', teacher.id)

    await answered(student.id, govern, korean(1, '21:05'), true)
    await answered(student.id, impulse, korean(1, '21:07'), true)
    await answered(student.id, govern, korean(1, '21:09'), false)
    await answered(student.id, impulse, korean(3, '08:30'), false)

    const log = await studyLog(student.id)
    expect(log.days).toHaveLength(2)
    expect(log.activeDays).toBe(2)
    expect(log.total).toBe(4)

    const [recent, older] = log.days
    expect(recent!.total).toBe(3)
    expect(recent!.correct).toBe(2)
    expect(older!.total).toBe(1)
    expect(older!.correct).toBe(0)
  })

  it('leaves a day out when nothing was answered', async () => {
    // The gap is the finding. A zero row would read as "studied, got nothing".
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const govern = await word('govern', teacher.id)

    await answered(student.id, govern, korean(0, '10:00'), true)
    await answered(student.id, govern, korean(4, '10:00'), true)

    const log = await studyLog(student.id)
    expect(log.days).toHaveLength(2)
    expect(log.activeDays).toBe(2)
  })

  it('names the words that went wrong, worst first', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const govern = await word('govern', teacher.id)
    const impulse = await word('impulse', teacher.id)

    await answered(student.id, govern, korean(0, '09:00'), false)
    await answered(student.id, impulse, korean(0, '09:01'), false)
    await answered(student.id, impulse, korean(0, '09:02'), false)
    await answered(student.id, govern, korean(0, '09:03'), true)

    const [today] = (await studyLog(student.id)).days
    expect(today!.missed).toEqual([
      { lemma: 'impulse', wrong: 2 },
      { lemma: 'govern', wrong: 1 },
    ])
  })

  it('says nothing went wrong when nothing did', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const govern = await word('govern', teacher.id)
    await answered(student.id, govern, korean(0, '09:00'), true)

    const [today] = (await studyLog(student.id)).days
    expect(today!.missed).toEqual([])
  })

  it('splits a late-night session at Korean midnight, not UTC', async () => {
    // 00:30 in Seoul is 15:30 the previous day in UTC. Grouping on the raw
    // timestamp would file this under yesterday for the person who sat through
    // it tonight.
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const govern = await word('govern', teacher.id)

    await answered(student.id, govern, korean(1, '23:50'), true)
    await answered(student.id, govern, korean(0, '00:30'), true)

    const log = await studyLog(student.id)
    expect(log.days).toHaveLength(2)
  })

  it('drops what falls outside the window', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const govern = await word('govern', teacher.id)

    await answered(student.id, govern, korean(0, '09:00'), true)
    await answered(student.id, govern, korean(40, '09:00'), true)

    const log = await studyLog(student.id, { window: 7 })
    expect(log.days).toHaveLength(1)
    expect(log.window).toBe(7)
  })

  it('counts no more days than the window it names', async () => {
    // The window is calendar days, not a rolling stack of 24-hour blocks. A
    // rolling one reaches back into a further, partial day, and the screen
    // then reads "최근 2일 중 3일 학습".
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const govern = await word('govern', teacher.id)

    await answered(student.id, govern, korean(0, '23:30'), true)
    await answered(student.id, govern, korean(1, '23:30'), true)
    await answered(student.id, govern, korean(2, '23:30'), true)

    const log = await studyLog(student.id, { window: 2 })
    expect(log.activeDays).toBeLessThanOrEqual(log.window)
    expect(log.days.map((day) => day.day)).toEqual([koreanDay(0), koreanDay(1)])
  })

  it('keeps the worst six of a day, not the whole transcript', async () => {
    // Trimming has to happen per day. A flat cap across the query spends
    // itself on the newest days and leaves older ones looking spotless.
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const lemmas = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8']
    for (const [index, lemma] of lemmas.entries()) {
      const id = await word(lemma, teacher.id)
      // Earlier lemmas go wrong more often, so they must survive the trim.
      for (let time = lemmas.length - index; time > 0; time -= 1) {
        await answered(student.id, id, korean(0, '09:00'), false)
      }
    }

    const [today] = (await studyLog(student.id)).days
    expect(today!.missed).toHaveLength(6)
    expect(today!.missed.map((word) => word.lemma)).toEqual(lemmas.slice(0, 6))
    expect(today!.missed[0]!.wrong).toBeGreaterThan(today!.missed[5]!.wrong)
  })

  it('never shows one student another’s work', async () => {
    const teacher = await createUser('teacher')
    const mine = await createUser('student')
    const theirs = await createUser('student')
    const govern = await word('govern', teacher.id)
    await answered(theirs.id, govern, korean(0, '09:00'), true)

    const log = await studyLog(mine.id)
    expect(log.days).toEqual([])
    expect(log.lastStudiedAt).toBeNull()
  })

  it('reports when each student last worked, for the list', async () => {
    const teacher = await createUser('teacher')
    const busy = await createUser('student')
    const idle = await createUser('student')
    const govern = await word('govern', teacher.id)
    await answered(busy.id, govern, korean(2, '09:00'), true)

    const seen = await lastStudiedByStudent([busy.id, idle.id])
    expect(seen.has(busy.id)).toBe(true)
    expect(seen.has(idle.id)).toBe(false)
  })

  it('has nothing to report for nobody', async () => {
    expect(await lastStudiedByStudent([])).toEqual(new Map())
  })
})

describe('how long ago', () => {
  const now = new Date('2026-09-05T12:00:00+09:00')

  it('answers in the words a tutor would use', () => {
    expect(agoKo(new Date('2026-09-05T01:00:00+09:00'), now)).toBe('오늘')
    expect(agoKo(new Date('2026-09-04T23:00:00+09:00'), now)).toBe('어제')
    expect(agoKo(new Date('2026-09-01T09:00:00+09:00'), now)).toBe('4일 전')
    expect(agoKo(new Date('2026-06-05T09:00:00+09:00'), now)).toBe('3개월 전')
  })

  it('says so when there is nothing', () => {
    expect(agoKo(null, now)).toBe('기록 없음')
  })
})
