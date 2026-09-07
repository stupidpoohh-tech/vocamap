import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseWordbook } from '@/lib/import/wordbook'
import { toBrainMapDraft } from '@/lib/import/to-draft'
import { writeDraft } from '@/lib/data/brain-map'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { addToSet, createSet } from '@/lib/data/teacher'
import { buildSemanticMap } from '@/lib/data/semantic-map'
import { buildScopedQueue } from '@/lib/data/study'
import { buildQuestions } from '@/lib/learning/questions'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

/**
 * An exam range that is a table and nothing else: 어휘, 영영 풀이, 의미, no
 * sentences, no collocations, no derived forms.
 *
 * It is the ordinary case, not an edge one — it is what a teacher has the
 * evening before a test — and until the definition became a question it
 * produced a map of one card saying it had no questions.
 */
const TABLE = readFileSync(new URL('./fixtures/wordbook-table.txt', import.meta.url), 'utf8')

describe.skipIf(!hasDatabase)('a range of definitions', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function importRange() {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const { entries, problems } = parseWordbook(TABLE)
    expect(problems).toEqual([])

    const setId = await createSet({ ownerId: teacher.id, title: '시험 범위' })
    const ids: Array<{ lemma: string; id: string }> = []
    for (const entry of entries) {
      const draft = toBrainMapDraft(entry)
      const { id } = await findOrCreateVocabulary({
        lemma: entry.lemma,
        partOfSpeech: entry.senses[0]?.partOfSpeech ?? null,
        translations: draft.primaryTranslations,
        createdBy: teacher.id,
      })
      await writeDraft(id, draft, { status: 'approved', createdBy: teacher.id })
      ids.push({ lemma: entry.lemma, id })
    }
    await addToSet(setId, ids.map((w) => w.id))
    return { teacher, student, setId, ids }
  }

  it('gives every word in the range a question', async () => {
    const { student, ids } = await importRange()
    expect(ids).toHaveLength(50)

    for (const { lemma, id } of ids) {
      const map = (await buildSemanticMap(student.id, id))!
      const questions = map.nodes.flatMap((n) => n.exercises)
      expect(questions.length, lemma).toBeGreaterThan(0)
    }
  })

  it('asks for the definition, never for the gloss printed above it', async () => {
    const { student, ids } = await importRange()
    const map = (await buildSemanticMap(student.id, ids[0]!.id))!
    const node = map.nodes[0]!
    const [question] = node.exercises

    expect(node.label).toBe('장점, 강점')
    if (question?.kind !== 'choice') throw new Error('unreachable')
    expect(question.answer).toBe('a quality or ability that gives you an advantage')
    // The wrong answers are the words beside it on the same list.
    expect(question.options).toHaveLength(4)
    for (const option of question.options) expect(option).not.toBe(node.label)
  })

  it('sets the paper\'s own question in the test session', async () => {
    const { student, setId, ids } = await importRange()
    const queue = await buildScopedQueue(student.id, { scope: 'all', setId, wordLimit: 50 })
    const questions = await buildQuestions(student.id, queue)

    const definition = questions.filter((q) => q.kind === 'definition')
    expect(definition.length).toBeGreaterThan(0)

    const one = definition[0]!
    // English definition in, English word out — and the rivals are words from
    // this range, not from anywhere in the library.
    expect(one.direction).toBe('ko_en')
    expect(one.options).toContain(one.answer)
    expect(one.options).toHaveLength(4)
    const inRange = new Set(ids.map((w) => w.lemma))
    for (const option of one.options) expect(inRange.has(option), option).toBe(true)
  })
})
