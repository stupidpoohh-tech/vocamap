import { beforeEach, describe, expect, it } from 'vitest'
import { buildQuestions } from '@/lib/learning/questions'
import { addToSet, createSet } from '@/lib/data/teacher'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { buildScopedQueue } from '@/lib/data/study'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

/**
 * A distractor's whole job is to be a plausible wrong answer.
 *
 * Drawn from anywhere in the library they are not: asked for `govern` beside
 * `refrigeration` and `celebrity`, a student crosses those off by topic and
 * never has to know the word. The words a teacher put in one set are the ones
 * that turn up together on the paper.
 */
describe.skipIf(!hasDatabase)('question distractors', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function twoSets() {
    const teacher = await createUser('teacher')
    const student = await createUser('student')

    const examWords = ['govern', 'assert', 'disrupt', 'compromise', 'aspire']
    const otherWords = ['refrigeration', 'celebrity', 'magnetic', 'monetary']

    const make = async (lemma: string, index: number) =>
      (await findOrCreateVocabulary({
        lemma,
        translations: [`${lemma}의 뜻`],
        createdBy: teacher.id,
      })).id

    const exam = await Promise.all(examWords.map(make))
    const other = await Promise.all(otherWords.map(make))

    const examSet = await createSet({ ownerId: teacher.id, title: '기말 범위' })
    const otherSet = await createSet({ ownerId: teacher.id, title: '다른 단원' })
    await addToSet(examSet, exam)
    await addToSet(otherSet, other)

    return { student, examSet, examWords, otherWords }
  }

  it('fills the options from the word’s own set', async () => {
    const { student, examSet, examWords, otherWords } = await twoSets()

    const queue = await buildScopedQueue(student.id, {
      scope: 'all',
      setId: examSet,
      directions: ['en_ko'],
    })
    expect(queue.length).toBeGreaterThan(0)

    const questions = await buildQuestions(student.id, queue)
    const sameSetGlosses = new Set(examWords.map((w) => `${w}의 뜻`))
    const otherGlosses = new Set(otherWords.map((w) => `${w}의 뜻`))

    for (const question of questions) {
      expect(question.options).toHaveLength(4)
      expect(question.options).toContain(question.answer)
      for (const option of question.options) {
        // Every option is a word the teacher grouped with this one, and none
        // leaked in from the unit it does not belong to.
        expect(sameSetGlosses.has(option), option).toBe(true)
        expect(otherGlosses.has(option), option).toBe(false)
      }
    }
  })

  it('still fills four options for a word in no set', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    for (const lemma of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
      await findOrCreateVocabulary({
        lemma,
        translations: [`${lemma} 뜻`],
        createdBy: teacher.id,
      })
    }

    const queue = await buildScopedQueue(student.id, {
      scope: 'all',
      unassigned: true,
      directions: ['en_ko'],
    })
    const questions = await buildQuestions(student.id, queue)

    expect(questions.length).toBeGreaterThan(0)
    for (const question of questions) {
      expect(question.options).toHaveLength(4)
      expect(new Set(question.options).size).toBe(4)
      expect(question.options).toContain(question.answer)
    }
  })

  it('never repeats an option or gives the answer away twice', async () => {
    const { student, examSet } = await twoSets()
    const queue = await buildScopedQueue(student.id, {
      scope: 'all',
      setId: examSet,
      directions: ['en_ko', 'ko_en'],
    })
    for (const question of await buildQuestions(student.id, queue)) {
      expect(new Set(question.options).size).toBe(question.options.length)
    }
  })
})
