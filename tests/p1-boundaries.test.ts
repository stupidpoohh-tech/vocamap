import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brainMapMeanings, brainMaps, userVocabularyState } from '@/lib/db/schema'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { writeDraft, setBrainMapStatus } from '@/lib/data/brain-map'
import { buildQuestions } from '@/lib/learning/questions'
import { buildScopedQueue, markImportant } from '@/lib/data/study'
import { markBrainMapOpened } from '@/lib/data/personal'
import { addToSet, createSet } from '@/lib/data/teacher'
import { brainMapDraftSchema } from '@/lib/ai/schema'
import {
  approveReading,
  countReadingCandidates,
  listReadingCandidates,
  rejectReading,
} from '@/lib/data/definition-reading'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

const MAPPED = brainMapDraftSchema.parse({
  meaningCoreKo: '어떤 상태가 이어지도록 계속 붙들고 있는 것.',
  meaningCoreEn: null,
  primaryTranslations: ['유지하다'],
  meanings: [
    {
      ko: '유지하다, 지속하다',
      enDefinition: 'to keep something in the same condition',
      enDefinitionKo: null,
      connectionNote: '붙들고 있으니 상태가 그대로 이어진다.',
      exampleChunk: 'maintain a balance',
    },
  ],
  sentences: [
    {
      text: 'Engineers maintain the bridge every spring.',
      ko: '기술자들이 매년 봄 다리를 점검한다.',
      targetMeaning: '유지하다',
      highlight: 'maintain',
      difficulty: 2,
    },
  ],
  collocations: [{ expression: 'maintain a balance', ko: '균형을 유지하다', exampleSentence: null, importance: 1 }],
  wordFamily: [],
  similarWords: [],
})

/* ══════ P1-5 · basic recall measures one thing, whatever the word has ═════ */

describe.skipIf(!hasDatabase)('the basic recall session', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function mappedWordInASet() {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const ids: string[] = []
    for (const [lemma, ko] of [
      ['maintain', '유지하다'],
      ['declare', '선언하다'],
      ['abandon', '포기하다'],
      ['connect', '연결하다'],
    ] as const) {
      const { id } = await findOrCreateVocabulary({ lemma, translations: [ko] })
      ids.push(id)
    }
    const setId = await createSet({ ownerId: teacher.id, title: '범위' })
    await addToSet(setId, ids)

    const brainMapId = await writeDraft(ids[0]!, MAPPED, {
      status: 'approved',
      createdBy: teacher.id,
    })
    await setBrainMapStatus(brainMapId, 'approved', teacher.id)
    return { student, setId, mappedId: ids[0]! }
  }

  it('asks the plain question even when the word has a map', async () => {
    // A map is not a request. This used to swap in a collocation or a blanked
    // sentence for exactly the mapped words, against the same card and the same
    // schedule — so two students with identical histories were measured on
    // different things.
    const { student, setId, mappedId } = await mappedWordInASet()
    const queue = await buildScopedQueue(student.id, { scope: 'all', setId })

    const questions = await buildQuestions(student.id, queue)

    const mapped = questions.filter((q) => q.vocabularyId === mappedId)
    expect(mapped.length).toBeGreaterThan(0)
    expect(mapped.every((q) => q.kind === 'gloss')).toBe(true)
  })

  it('asks the richer questions when the reader chose the map test', async () => {
    const { student, setId, mappedId } = await mappedWordInASet()
    const queue = await buildScopedQueue(student.id, { scope: 'all', setId })

    const questions = await buildQuestions(student.id, queue, { extended: true })

    const mapped = questions.filter((q) => q.vocabularyId === mappedId)
    expect(mapped.some((q) => q.kind !== 'gloss')).toBe(true)
  })

  it('signs every question it issues', async () => {
    const { student, setId } = await mappedWordInASet()
    const queue = await buildScopedQueue(student.id, { scope: 'all', setId })
    const questions = await buildQuestions(student.id, queue)

    const { verifyQuestion } = await import('@/lib/learning/question-token')
    for (const question of questions) {
      const claims = await verifyQuestion(question.token)
      expect(claims).not.toBeNull()
      expect(claims!.userId).toBe(student.id)
      expect(claims!.vocabularyId).toBe(question.vocabularyId)
      expect(claims!.answer).toBe(question.answer)
      expect(claims!.options).toEqual(question.options)
    }
  })

  it('gives each asking its own submission id', async () => {
    const { student, setId } = await mappedWordInASet()
    const queue = await buildScopedQueue(student.id, { scope: 'all', setId })
    const { verifyQuestion } = await import('@/lib/learning/question-token')

    const first = await buildQuestions(student.id, queue)
    const second = await buildQuestions(student.id, queue)

    const ids = await Promise.all(
      [...first, ...second].map(async (q) => (await verifyQuestion(q.token))!.submissionId),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })
})

/* ══════════ P1-6 · a recommendation that can actually be settled ═════════ */

describe.skipIf(!hasDatabase)('opening a map after it was recommended', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  /** The condition the word page uses to decide whether to record a visit. */
  const shouldRecord = (openedAt: Date | null, recommendedAt: Date | null) =>
    openedAt === null || (recommendedAt !== null && openedAt < recommendedAt)

  async function state(userId: string, vocabularyId: string) {
    const [row] = await db
      .select()
      .from(userVocabularyState)
      .where(
        and(
          eq(userVocabularyState.userId, userId),
          eq(userVocabularyState.vocabularyId, vocabularyId),
        ),
      )
    return row
  }

  it('settles a recommendation made after the map was first read', async () => {
    // The bug: opening was recorded once, ever, while the recommendation was
    // only considered answered by an open *later than* it. A student who had
    // read the map and then started getting the word wrong could never clear
    // it — reopening wrote nothing.
    const student = await createUser('student')
    const teacher = await createUser('teacher')
    const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'maintain' })

    await markBrainMapOpened(student.id, vocabularyId)
    const afterFirstRead = await state(student.id, vocabularyId)
    expect(shouldRecord(afterFirstRead!.brainMapOpenedAt, afterFirstRead!.brainMapRecommendedAt)).toBe(
      false,
    )

    await new Promise((r) => setTimeout(r, 10))
    await markImportant({
      userId: student.id,
      vocabularyId,
      important: true,
      reason: 'teacher_selected',
      markedBy: teacher.id,
    })

    const recommended = await state(student.id, vocabularyId)
    expect(recommended!.brainMapRecommendedAt).not.toBeNull()
    // The page now knows this visit is worth recording — which is the whole fix.
    expect(shouldRecord(recommended!.brainMapOpenedAt, recommended!.brainMapRecommendedAt)).toBe(true)

    await new Promise((r) => setTimeout(r, 10))
    await markBrainMapOpened(student.id, vocabularyId)

    const settled = await state(student.id, vocabularyId)
    expect(settled!.brainMapOpenedAt!.getTime()).toBeGreaterThan(
      settled!.brainMapRecommendedAt!.getTime(),
    )
    expect(shouldRecord(settled!.brainMapOpenedAt, settled!.brainMapRecommendedAt)).toBe(false)
  })

  it('records the first visit even with nothing recommended', async () => {
    expect(shouldRecord(null, null)).toBe(true)
  })

  it('stays quiet on a revisit with nothing new', async () => {
    const opened = new Date('2026-09-01T00:00:00Z')
    const recommended = new Date('2026-08-01T00:00:00Z')
    expect(shouldRecord(opened, recommended)).toBe(false)
  })

  it('wakes again for a recommendation made after the last visit', async () => {
    const opened = new Date('2026-08-01T00:00:00Z')
    const recommended = new Date('2026-09-01T00:00:00Z')
    expect(shouldRecord(opened, recommended)).toBe(true)
  })
})

/* ═══════ P1-4 · a model's reading waits for somebody to read it ═════════ */

describe.skipIf(!hasDatabase)('an AI-written reading', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function candidate() {
    const curator = await createUser('teacher')
    const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'maintain' })
    const brainMapId = await writeDraft(vocabularyId, MAPPED, {
      status: 'approved',
      createdBy: curator.id,
    })
    await setBrainMapStatus(brainMapId, 'approved', curator.id)
    const [meaning] = await db
      .select()
      .from(brainMapMeanings)
      .where(eq(brainMapMeanings.brainMapId, brainMapId))
    return { curator, vocabularyId, meaningId: meaning!.id }
  }

  it('is not visible to a reader before it is approved', async () => {
    const { meaningId } = await candidate()
    await db
      .update(brainMapMeanings)
      .set({
        enDefinitionKoDraft: '무언가를 같은 상태로 계속 두다.',
        enDefinitionKoModel: 'mock',
        enDefinitionKoPromptVersion: 'test/1',
        enDefinitionKoGeneratedAt: new Date(),
      })
      .where(eq(brainMapMeanings.id, meaningId))

    const [row] = await db
      .select({ live: brainMapMeanings.enDefinitionKo })
      .from(brainMapMeanings)
      .where(eq(brainMapMeanings.id, meaningId))
    expect(row!.live).toBeNull()
    expect(await countReadingCandidates()).toBe(1)
  })

  it('becomes visible when a curator approves it, with who and when recorded', async () => {
    const { curator, meaningId } = await candidate()
    await db
      .update(brainMapMeanings)
      .set({ enDefinitionKoDraft: '모델이 쓴 해석', enDefinitionKoModel: 'mock' })
      .where(eq(brainMapMeanings.id, meaningId))

    expect(await approveReading({ meaningId, text: '모델이 쓴 해석', approvedBy: curator.id })).toBe(
      true,
    )

    const [row] = await db.select().from(brainMapMeanings).where(eq(brainMapMeanings.id, meaningId))
    expect(row!.enDefinitionKo).toBe('모델이 쓴 해석')
    expect(row!.enDefinitionKoDraft).toBeNull()
    expect(row!.enDefinitionKoApprovedBy).toBe(curator.id)
    expect(row!.enDefinitionKoApprovedAt).not.toBeNull()
    // The provenance survives approval.
    expect(row!.enDefinitionKoModel).toBe('mock')
    expect(await countReadingCandidates()).toBe(0)
  })

  it('publishes the reviewer’s correction rather than the model’s text', async () => {
    const { curator, meaningId } = await candidate()
    await db
      .update(brainMapMeanings)
      .set({ enDefinitionKoDraft: '모델이 쓴 어색한 해석' })
      .where(eq(brainMapMeanings.id, meaningId))

    await approveReading({ meaningId, text: '검수자가 고친 해석', approvedBy: curator.id })

    const [row] = await db.select().from(brainMapMeanings).where(eq(brainMapMeanings.id, meaningId))
    expect(row!.enDefinitionKo).toBe('검수자가 고친 해석')
  })

  it('lets only the first of two approvals through', async () => {
    const { curator, meaningId } = await candidate()
    const other = await createUser('teacher')
    await db
      .update(brainMapMeanings)
      .set({ enDefinitionKoDraft: '후보' })
      .where(eq(brainMapMeanings.id, meaningId))

    const results = await Promise.all([
      approveReading({ meaningId, text: '첫 번째', approvedBy: curator.id }),
      approveReading({ meaningId, text: '두 번째', approvedBy: other.id }),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    const [row] = await db.select().from(brainMapMeanings).where(eq(brainMapMeanings.id, meaningId))
    expect(['첫 번째', '두 번째']).toContain(row!.enDefinitionKo)
  })

  it('does not overwrite a reading a person already wrote', async () => {
    const { curator, meaningId } = await candidate()
    await db
      .update(brainMapMeanings)
      .set({ enDefinitionKo: '사람이 쓴 해석', enDefinitionKoDraft: '늦게 도착한 모델 해석' })
      .where(eq(brainMapMeanings.id, meaningId))

    expect(await approveReading({ meaningId, text: '늦게 도착한 모델 해석', approvedBy: curator.id })).toBe(
      false,
    )
    const [row] = await db.select().from(brainMapMeanings).where(eq(brainMapMeanings.id, meaningId))
    expect(row!.enDefinitionKo).toBe('사람이 쓴 해석')
  })

  it('leaves the published reading alone when a candidate is discarded', async () => {
    const { meaningId } = await candidate()
    await db
      .update(brainMapMeanings)
      .set({ enDefinitionKo: '이미 공개된 해석', enDefinitionKoDraft: '버릴 후보' })
      .where(eq(brainMapMeanings.id, meaningId))

    expect(await rejectReading(meaningId)).toBe(true)

    const [row] = await db.select().from(brainMapMeanings).where(eq(brainMapMeanings.id, meaningId))
    expect(row!.enDefinitionKo).toBe('이미 공개된 해석')
    expect(row!.enDefinitionKoDraft).toBeNull()
  })

  it('lists a candidate with the model and prompt version that produced it', async () => {
    const { meaningId } = await candidate()
    await db
      .update(brainMapMeanings)
      .set({
        enDefinitionKoDraft: '후보 해석',
        enDefinitionKoModel: 'template-dev',
        enDefinitionKoPromptVersion: 'definition-reading/2026-09-08',
        enDefinitionKoGeneratedAt: new Date(),
      })
      .where(eq(brainMapMeanings.id, meaningId))

    const [listed] = await listReadingCandidates()
    expect(listed!.id).toBe(meaningId)
    expect(listed!.lemma).toBe('maintain')
    expect(listed!.model).toBe('template-dev')
    expect(listed!.promptVersion).toBe('definition-reading/2026-09-08')
    expect(listed!.generatedAt).not.toBeNull()
  })
})

/* ═══════════ P1-4 · the generator writes candidates, not content ════════ */

describe.skipIf(!hasDatabase)('running the reading generator', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('proposes without publishing, and leaves a second run alone', async () => {
    // Verified with the template provider — no paid call is made.
    const { setLLMProvider, TemplateProvider } = await import('@/lib/ai/provider')
    const { fillDefinitionReadings } = await import('@/lib/data/definition-reading')
    setLLMProvider(new TemplateProvider())
    try {
      const curator = await createUser('teacher')
      const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'maintain' })
      const brainMapId = await writeDraft(vocabularyId, MAPPED, {
        status: 'approved',
        createdBy: curator.id,
      })
      await setBrainMapStatus(brainMapId, 'approved', curator.id)

      const first = await fillDefinitionReadings()
      expect(first.filled).toBe(1)

      const [row] = await db
        .select()
        .from(brainMapMeanings)
        .where(eq(brainMapMeanings.brainMapId, brainMapId))
      // Proposed, not published.
      expect(row!.enDefinitionKoDraft).not.toBeNull()
      expect(row!.enDefinitionKo).toBeNull()
      expect(row!.enDefinitionKoModel).toBe('template-dev')
      expect(row!.enDefinitionKoGeneratedAt).not.toBeNull()

      // A second run must not replace a candidate a curator may be reading.
      const before = row!.enDefinitionKoDraft
      const second = await fillDefinitionReadings()
      expect(second.filled).toBe(0)
      const [again] = await db
        .select()
        .from(brainMapMeanings)
        .where(eq(brainMapMeanings.brainMapId, brainMapId))
      expect(again!.enDefinitionKoDraft).toBe(before)
    } finally {
      setLLMProvider(null)
    }
  })
})

/* ═══ P1-5 · readings that predate the review step ═══════════════════════ */

describe.skipIf(!hasDatabase)('a reading published before there was a review step', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function published(meta: { model?: string | null; reviewNote?: string | null }) {
    const curator = await createUser('teacher')
    const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'maintain' })
    const brainMapId = await writeDraft(vocabularyId, MAPPED, {
      status: 'approved',
      createdBy: curator.id,
      model: meta.model ?? null,
      reviewNote: meta.reviewNote ?? null,
    })
    // Approving rewrites the review note, so it is restored afterwards — the
    // import path writes the note and never calls `setBrainMapStatus`.
    await setBrainMapStatus(brainMapId, 'approved', curator.id)
    await db
      .update(brainMaps)
      .set({ generatedByModel: meta.model ?? null, reviewNote: meta.reviewNote ?? null })
      .where(eq(brainMaps.id, brainMapId))

    const [meaning] = await db
      .select()
      .from(brainMapMeanings)
      .where(eq(brainMapMeanings.brainMapId, brainMapId))
    await db
      .update(brainMapMeanings)
      .set({ enDefinitionKo: '오래전에 공개된 해석' })
      .where(eq(brainMapMeanings.id, meaning!.id))
    return { curator, meaningId: meaning!.id }
  }

  it('stays visible and is not marked as approved by anyone', async () => {
    const { meaningId } = await published({})
    const [row] = await db.select().from(brainMapMeanings).where(eq(brainMapMeanings.id, meaningId))

    expect(row!.enDefinitionKo).toBe('오래전에 공개된 해석')
    expect(row!.enDefinitionKoApprovedAt).toBeNull()
    expect(row!.enDefinitionKoApprovedBy).toBeNull()
  })

  it('is listed for re-review, with where it came from', async () => {
    const { listReadingsNeedingReview, countReadingsNeedingReview } = await import(
      '@/lib/data/definition-reading'
    )
    await published({ model: 'claude-opus-5' })

    const rows = await listReadingsNeedingReview()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.origin).toBe('ai_map')
    expect(rows[0]!.reading).toBe('오래전에 공개된 해석')
    expect(await countReadingsNeedingReview()).toBe(1)
  })

  it('calls a typed-in reading typed in, not AI', async () => {
    const { listReadingsNeedingReview } = await import('@/lib/data/definition-reading')
    await published({ reviewNote: '단어장 직접 입력' })
    expect((await listReadingsNeedingReview())[0]!.origin).toBe('typed_in')
  })

  it('falls back to the batch filler only when nothing else fits', async () => {
    const { listReadingsNeedingReview } = await import('@/lib/data/definition-reading')
    await published({})
    expect((await listReadingsNeedingReview())[0]!.origin).toBe('ai_batch')
  })

  it('records who confirmed it, without changing what students see', async () => {
    const { confirmExistingReading, listReadingsNeedingReview } = await import(
      '@/lib/data/definition-reading'
    )
    const { curator, meaningId } = await published({})

    expect(
      await confirmExistingReading({
        meaningId,
        text: '오래전에 공개된 해석',
        approvedBy: curator.id,
      }),
    ).toBe(true)

    const [row] = await db.select().from(brainMapMeanings).where(eq(brainMapMeanings.id, meaningId))
    expect(row!.enDefinitionKo).toBe('오래전에 공개된 해석')
    expect(row!.enDefinitionKoApprovedBy).toBe(curator.id)
    expect(await listReadingsNeedingReview()).toEqual([])
  })

  it('lets the reviewer correct it while confirming', async () => {
    const { confirmExistingReading } = await import('@/lib/data/definition-reading')
    const { curator, meaningId } = await published({})

    await confirmExistingReading({ meaningId, text: '고쳐 쓴 해석', approvedBy: curator.id })

    const [row] = await db.select().from(brainMapMeanings).where(eq(brainMapMeanings.id, meaningId))
    expect(row!.enDefinitionKo).toBe('고쳐 쓴 해석')
  })

  it('does not let a second curator re-stamp one already signed', async () => {
    const { confirmExistingReading } = await import('@/lib/data/definition-reading')
    const { curator, meaningId } = await published({})
    const other = await createUser('teacher')

    await confirmExistingReading({ meaningId, text: '첫 확인', approvedBy: curator.id })
    expect(
      await confirmExistingReading({ meaningId, text: '두 번째', approvedBy: other.id }),
    ).toBe(false)

    const [row] = await db.select().from(brainMapMeanings).where(eq(brainMapMeanings.id, meaningId))
    expect(row!.enDefinitionKoApprovedBy).toBe(curator.id)
    expect(row!.enDefinitionKo).toBe('첫 확인')
  })
})
