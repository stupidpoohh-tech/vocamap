import { beforeEach, describe, expect, it } from 'vitest'
import { listWordSets } from '@/lib/data/library'
import { addToSet, createSet } from '@/lib/data/teacher'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { recordRecallAnswer } from '@/lib/data/study'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

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
})
