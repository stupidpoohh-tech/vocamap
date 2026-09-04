import { beforeEach, describe, expect, it } from 'vitest'
import { listWordSets } from '@/lib/data/library'
import { writeDraft } from '@/lib/data/brain-map'
import { addToSet, createSet } from '@/lib/data/teacher'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { buildScopedQueue, recordRecallAnswer } from '@/lib/data/study'
import type { BrainMapDraft } from '@/lib/ai/schema'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

const draft = (lemma: string): BrainMapDraft => ({
  meaningCoreKo: `${lemma}의 중심 의미.`,
  meaningCoreEn: null,
  primaryTranslations: [`${lemma} 뜻`],
  meanings: [
    { ko: '기본 뜻', enDefinition: null, connectionNote: '중심 의미에서 나온다.', exampleChunk: null },
  ],
  sentences: [
    {
      text: `They ${lemma} the standard every year.`,
      ko: '그들은 매년 그 기준을 지킨다.',
      targetMeaning: '기준을 지키다',
      highlight: lemma,
      difficulty: 2,
    },
  ],
  collocations: [
    { expression: `${lemma} quality`, ko: '품질을 지키다', exampleSentence: null, importance: 1 },
  ],
  wordFamily: [],
  similarWords: [],
})

/**
 * One set a day, then that set's test.
 *
 * The shelf has to answer "which one do I do today", so a set the student has
 * already worked through must look different from one they have not opened.
 */
describe.skipIf(!hasDatabase)('studying a set', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function aSet(title: string, lemmas: string[], teacherId: string) {
    const ids: string[] = []
    for (const lemma of lemmas) {
      const { id } = await findOrCreateVocabulary({
        lemma,
        translations: [`${lemma} 뜻`],
        createdBy: teacherId,
      })
      ids.push(id)
    }
    const setId = await createSet({ ownerId: teacherId, title })
    await addToSet(setId, ids)
    return { setId, ids }
  }

  it('counts a set as untouched until the student answers something', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const { setId } = await aSet('1주차', ['alpha', 'beta', 'gamma'], teacher.id)

    const shelf = await listWordSets(student.id)
    const mine = shelf.find((s) => s.id === setId)!
    expect(mine.wordCount).toBe(3)
    expect(mine.studiedCount).toBe(0)
  })

  it('counts each word once however many directions were answered', async () => {
    // A card exists per direction. Counting rows would say a three-word set of
    // which one word was answered is "2/3 done".
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const { setId, ids } = await aSet('1주차', ['alpha', 'beta', 'gamma'], teacher.id)

    for (const direction of ['en_ko', 'ko_en'] as const) {
      await recordRecallAnswer({
        userId: student.id,
        vocabularyId: ids[0]!,
        direction,
        correct: true,
        responseTimeMs: 900,
        questionType: 'recall_choice',
      })
    }

    const mine = (await listWordSets(student.id)).find((s) => s.id === setId)!
    expect(mine.studiedCount).toBe(1)
    expect(mine.wordCount).toBe(3)
  })

  it('keeps one student’s progress out of another’s shelf', async () => {
    const teacher = await createUser('teacher')
    const alice = await createUser('student')
    const bob = await createUser('student')
    const { setId, ids } = await aSet('1주차', ['alpha', 'beta'], teacher.id)

    await recordRecallAnswer({
      userId: alice.id,
      vocabularyId: ids[0]!,
      direction: 'en_ko',
      correct: true,
      responseTimeMs: 900,
      questionType: 'recall_choice',
    })

    const forAlice = (await listWordSets(alice.id)).find((s) => s.id === setId)!
    const forBob = (await listWordSets(bob.id)).find((s) => s.id === setId)!
    expect(forAlice.studiedCount).toBe(1)
    expect(forBob.studiedCount).toBe(0)
  })

  it('counts progress in the set the word belongs to, not across the library', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const week1 = await aSet('1주차', ['alpha', 'beta'], teacher.id)
    const week2 = await aSet('2주차', ['gamma', 'delta'], teacher.id)

    await recordRecallAnswer({
      userId: student.id,
      vocabularyId: week1.ids[0]!,
      direction: 'en_ko',
      correct: true,
      responseTimeMs: 900,
      questionType: 'recall_choice',
    })

    const shelf = await listWordSets(student.id)
    expect(shelf.find((s) => s.id === week1.setId)!.studiedCount).toBe(1)
    expect(shelf.find((s) => s.id === week2.setId)!.studiedCount).toBe(0)
  })

  /**
   * The 맵 tab's own test.
   *
   * A set's map test covers the words in that set that carry a *published*
   * map — not every word in the set, which is the 단어 tab's test, and not a
   * curator's unfinished draft.
   */
  it('tests only the published maps in the set it was started from', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const { setId, ids } = await aSet('1주차', ['govern', 'impulse', 'normal'], teacher.id)

    await writeDraft(ids[0]!, draft('govern'), { status: 'approved', createdBy: teacher.id })
    await writeDraft(ids[1]!, draft('impulse'), { status: 'draft_ai', createdBy: teacher.id })

    const queue = await buildScopedQueue(student.id, {
      scope: 'mapped',
      setId,
      directions: ['en_ko'],
    })
    expect(queue.map((item) => item.lemma)).toEqual(['govern'])
  })

  it('does not reach into another set for its map test', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const mine = await aSet('1주차', ['govern'], teacher.id)
    const other = await aSet('2주차', ['impulse'], teacher.id)

    await writeDraft(mine.ids[0]!, draft('govern'), { status: 'approved', createdBy: teacher.id })
    await writeDraft(other.ids[0]!, draft('impulse'), { status: 'approved', createdBy: teacher.id })

    const queue = await buildScopedQueue(student.id, {
      scope: 'mapped',
      setId: mine.setId,
      directions: ['en_ko'],
    })
    expect(queue.map((item) => item.lemma)).toEqual(['govern'])
  })
})
