import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { learningEvents, reviewEvents, userVocabularyCards } from '@/lib/db/schema'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { recordRecallAnswer } from '@/lib/data/study'
import {
  grade,
  plausibleResponseTime,
  signQuestion,
  verifyQuestion,
} from '@/lib/learning/question-token'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

/* ═══════════════ P1-2 · the server decides what was right ═══════════════ */

describe('a question token', () => {
  const claims = {
    userId: 'u1',
    vocabularyId: 'v1',
    direction: 'en_ko' as const,
    kind: 'gloss' as const,
    answer: '유지하다',
    options: ['유지하다', '주장하다', '포기하다', '연결하다'],
    submissionId: '11111111-1111-1111-1111-111111111111',
  }

  it('comes back as it went out', async () => {
    const token = await signQuestion(claims)
    expect(await verifyQuestion(token)).toEqual({ ...claims, contentVersion: null })
  })

  it('refuses a token this server did not sign', async () => {
    // The forgery a client would have to manage to grade itself.
    const token = await signQuestion(claims)
    const [header, , signature] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ sub: 'u1', vid: 'v1', dir: 'en_ko', ans: '아무거나', opt: [], sid: 'x' }),
    ).toString('base64url')
    expect(await verifyQuestion(`${header}.${forged}.${signature}`)).toBeNull()
  })

  it('refuses a token that is not a token', async () => {
    expect(await verifyQuestion('')).toBeNull()
    expect(await verifyQuestion('not.a.jwt')).toBeNull()
  })

  it('grades against the answer it recorded, not the request', async () => {
    expect(grade(claims, '유지하다')).toEqual({ offered: true, correct: true })
    expect(grade(claims, '주장하다')).toEqual({ offered: true, correct: false })
  })

  it('treats an option that was never offered as no answer at all', async () => {
    // Not "wrong". A submission that does not correspond to the question must
    // not write a lapse into somebody's schedule.
    expect(grade(claims, '내가 지어낸 답')).toEqual({ offered: false, correct: false })
  })
})

describe('a reported response time', () => {
  it('keeps a plausible one', () => {
    expect(plausibleResponseTime(3200)).toBe(3200)
  })

  it('stores an impossible one as unknown rather than as a measurement', () => {
    expect(plausibleResponseTime(5)).toBeNull()
    expect(plausibleResponseTime(60 * 60 * 1000)).toBeNull()
    expect(plausibleResponseTime(-1)).toBeNull()
    expect(plausibleResponseTime('빠름')).toBeNull()
    expect(plausibleResponseTime(Number.NaN)).toBeNull()
  })
})

/* ═════════════ P1-2 · one answer is recorded exactly once ═══════════════ */

describe.skipIf(!hasDatabase)('sending the same answer again', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function setup() {
    const student = await createUser('student')
    const { id: vocabularyId } = await findOrCreateVocabulary({
      lemma: 'maintain',
      translations: ['유지하다'],
    })
    return { student, vocabularyId }
  }

  it('writes one event and advances the schedule once', async () => {
    const { student, vocabularyId } = await setup()
    const submissionId = '22222222-2222-2222-2222-222222222222'
    const answer = {
      userId: student.id,
      vocabularyId,
      direction: 'en_ko' as const,
      correct: true,
      submissionId,
    }

    const first = await recordRecallAnswer(answer)
    const [cardAfterFirst] = await db
      .select()
      .from(userVocabularyCards)
      .where(eq(userVocabularyCards.userId, student.id))

    const second = await recordRecallAnswer(answer)
    const [cardAfterSecond] = await db
      .select()
      .from(userVocabularyCards)
      .where(eq(userVocabularyCards.userId, student.id))

    expect(first.recorded).toBe(true)
    expect(second.recorded).toBe(false)
    expect(await db.select().from(reviewEvents)).toHaveLength(1)
    expect(cardAfterSecond).toEqual(cardAfterFirst)
    expect(second.nextDueAt.getTime()).toBe(first.nextDueAt.getTime())
  })

  it('records a deliberate second attempt as its own answer', async () => {
    // A retry carries the same id; answering the word again is a new question
    // with a new one, and has to count.
    const { student, vocabularyId } = await setup()
    const base = { userId: student.id, vocabularyId, direction: 'en_ko' as const, correct: true }

    await recordRecallAnswer({ ...base, submissionId: '33333333-3333-3333-3333-333333333333' })
    await recordRecallAnswer({ ...base, submissionId: '44444444-4444-4444-4444-444444444444' })

    expect(await db.select().from(reviewEvents)).toHaveLength(2)
    const [card] = await db.select().from(userVocabularyCards)
    expect(card!.reps).toBe(2)
  })

  it('still records answers that carry no submission id', async () => {
    // The map's own node answers do not issue tokens. The partial index must
    // not make them collide with each other.
    const { student, vocabularyId } = await setup()
    const base = { userId: student.id, vocabularyId, direction: 'en_ko' as const, correct: true }
    await recordRecallAnswer(base)
    await recordRecallAnswer(base)
    expect(await db.select().from(reviewEvents)).toHaveLength(2)
  })

  it('keeps one card consistent when two answers arrive at once', async () => {
    // Read-modify-write on the same card. Without serialisation both compute
    // from the same starting state and the second write discards the first.
    const { student, vocabularyId } = await setup()
    const base = { userId: student.id, vocabularyId, direction: 'en_ko' as const, correct: true }

    await Promise.all([
      recordRecallAnswer({ ...base, submissionId: '55555555-5555-5555-5555-555555555555' }),
      recordRecallAnswer({ ...base, submissionId: '66666666-6666-6666-6666-666666666666' }),
    ])

    expect(await db.select().from(reviewEvents)).toHaveLength(2)
    const [card] = await db.select().from(userVocabularyCards)
    // Both reviews landed on the card, rather than one overwriting the other.
    expect(card!.reps).toBe(2)
  })
})

/* ══════════ P1-1 · reading a translation is not answering ══════════════ */

describe.skipIf(!hasDatabase)('revealing a reading', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('records that it was read and changes nothing that is scored', async () => {
    const { logLearningEvent } = await import('@/lib/data/study')
    const student = await createUser('student')
    const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'maintain' })

    await logLearningEvent({
      userId: student.id,
      vocabularyId,
      kind: 'map_reading_revealed',
      payload: { node: 'meaning_core' },
    })

    // The event log has it.
    const events = await db
      .select()
      .from(learningEvents)
      .where(
        and(
          eq(learningEvents.userId, student.id),
          eq(learningEvents.kind, 'map_reading_revealed'),
        ),
      )
    expect(events).toHaveLength(1)

    // Nothing that is scored has moved.
    expect(await db.select().from(reviewEvents)).toEqual([])
    expect(await db.select().from(userVocabularyCards)).toEqual([])
  })

  it('leaves an existing schedule where it was', async () => {
    const { logLearningEvent } = await import('@/lib/data/study')
    const student = await createUser('student')
    const { id: vocabularyId } = await findOrCreateVocabulary({
      lemma: 'maintain',
      translations: ['유지하다'],
    })
    await recordRecallAnswer({
      userId: student.id,
      vocabularyId,
      direction: 'en_ko',
      correct: false,
    })
    const [before] = await db.select().from(userVocabularyCards)

    await logLearningEvent({ userId: student.id, vocabularyId, kind: 'map_reading_revealed' })

    const [after] = await db.select().from(userVocabularyCards)
    expect(after).toEqual(before)
    expect(await db.select().from(reviewEvents)).toHaveLength(1)
  })
})
