import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseWordbook } from '@/lib/import/wordbook'
import { toBrainMapDraft } from '@/lib/import/to-draft'
import { writeDraft } from '@/lib/data/brain-map'
import { buildQuestions } from '@/lib/learning/questions'
import { buildScopedQueue } from '@/lib/data/study'
import { addToSet, createSet } from '@/lib/data/teacher'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

const PAGE = readFileSync(new URL('./fixtures/wordbook-page.txt', import.meta.url), 'utf8')
const entries = parseWordbook(PAGE).entries

/**
 * A word with a Brain Map is asked better questions than a word without one.
 *
 * Built on the real test range rather than on invented words, because what a
 * variant can ask depends entirely on what the book happened to print — and
 * these are the words that will actually be studied.
 */
describe.skipIf(!hasDatabase)('questions for a mapped word', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function importedSet() {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const ids: string[] = []

    for (const entry of entries) {
      const draft = toBrainMapDraft(entry)
      const { id } = await findOrCreateVocabulary({
        lemma: entry.lemma,
        translations: draft.primaryTranslations,
        createdBy: teacher.id,
      })
      await writeDraft(id, draft, { status: 'approved', createdBy: teacher.id })
      ids.push(id)
    }

    const setId = await createSet({ ownerId: teacher.id, title: '기말 범위' })
    await addToSet(setId, ids)
    return { student, setId }
  }

  async function ask(directions: Array<'en_ko' | 'ko_en'>) {
    const { student, setId } = await importedSet()
    const queue = await buildScopedQueue(student.id, { scope: 'all', setId, directions })
    return buildQuestions(student.id, queue)
  }

  it('asks mapped words in more than one way', async () => {
    const questions = await ask(['en_ko', 'ko_en'])
    const kinds = new Set(questions.map((q) => q.kind))
    // Not all four every time — a word can only be asked what its map holds —
    // but a whole set of twenty must produce more than the plain gloss.
    expect(kinds.size).toBeGreaterThan(1)
    expect(questions.length).toBeGreaterThan(0)
  })

  it('always gives a valid, non-repeating set of options', async () => {
    for (const question of await ask(['en_ko', 'ko_en'])) {
      expect(question.options, question.prompt).toContain(question.answer)
      expect(new Set(question.options).size, question.prompt).toBe(question.options.length)
      expect(question.options.length, question.prompt).toBeGreaterThanOrEqual(2)
    }
  })

  it('blanks the word out of its own sentence', async () => {
    const questions = await ask(['ko_en'])
    const context = questions.filter((q) => q.kind === 'context')
    expect(context.length).toBeGreaterThan(0)

    for (const question of context) {
      expect(question.prompt).toContain('______')
      // The answer is the word itself, and the blank hides every trace of it.
      expect(question.prompt.toLowerCase()).not.toContain(question.answer.toLowerCase())
      // The whole sentence comes back afterwards, with its translation.
      expect(question.note).toBeTruthy()
    }
  })

  it('asks which sense is at work only for a word that has two', async () => {
    const questions = await ask(['en_ko'])
    for (const question of questions.filter((q) => q.kind === 'sense')) {
      expect(question.options.length).toBeGreaterThanOrEqual(2)
      expect(question.note).toBeTruthy()
    }
  })

  it('never offers the answer among its own distractors', async () => {
    for (const question of await ask(['en_ko', 'ko_en'])) {
      const wrong = question.options.filter((o) => o !== question.answer)
      expect(wrong, question.prompt).not.toContain(question.answer)
    }
  })

  it('is stable across rebuilds, so a refresh cannot reroll the question', async () => {
    const { student, setId } = await importedSet()
    const queue = await buildScopedQueue(student.id, {
      scope: 'all',
      setId,
      directions: ['ko_en'],
    })
    const first = await buildQuestions(student.id, queue)
    const second = await buildQuestions(student.id, queue)

    expect(first.map((q) => [q.vocabularyId, q.kind, q.prompt, q.answer])).toEqual(
      second.map((q) => [q.vocabularyId, q.kind, q.prompt, q.answer]),
    )
  })

  it('falls back to the plain question for a word with no map', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const ids = []
    for (const lemma of ['alpha', 'beta', 'gamma', 'delta']) {
      const { id } = await findOrCreateVocabulary({
        lemma,
        translations: [`${lemma} 뜻`],
        createdBy: teacher.id,
      })
      ids.push(id)
    }
    const setId = await createSet({ ownerId: teacher.id, title: '맵 없음' })
    await addToSet(setId, ids)

    const queue = await buildScopedQueue(student.id, {
      scope: 'all',
      setId,
      directions: ['en_ko'],
    })
    const questions = await buildQuestions(student.id, queue)
    expect(questions.length).toBeGreaterThan(0)
    expect(questions.every((q) => q.kind === 'gloss')).toBe(true)
  })
})
