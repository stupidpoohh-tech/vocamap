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

  it('asks which definition the meaning is, when the list gave no translation', async () => {
    // The range as typed: 어휘 / 영영 풀이 / 의미, and no 해석 column. There is
    // nothing to reveal, so the node asks rather than pretending — revealing
    // the word's gloss would be a check button that checks nothing, since the
    // gloss is already on the map, in the header and in the list.
    const { student, ids } = await importRange()
    const map = (await buildSemanticMap(student.id, ids[0]!.id))!
    const node = map.nodes[0]!
    const [question] = node.exercises

    expect(node.label).toBe('장점, 강점')
    if (question?.kind !== 'choice') throw new Error('unreachable')
    expect(question.answer).toBe('a quality or ability that gives you an advantage')
    expect(question.options).toHaveLength(4)
    for (const option of question.options) expect(option).not.toBe(node.label)
  })

  it('reveals the translation once the list carries one', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const table = [
      '| 어휘 | 영영 풀이 | 영영 풀이 해석 | 의미 |',
      '|---|---|---|---|',
      '| move | 명 a change of position or place | 위치나 장소의 변화 | 움직임, 동작 |',
    ].join('\n')

    const entry = parseWordbook(table).entries[0]!
    const draft = toBrainMapDraft(entry)
    const { id } = await findOrCreateVocabulary({
      lemma: entry.lemma,
      translations: draft.primaryTranslations,
      createdBy: teacher.id,
    })
    await writeDraft(id, draft, { status: 'approved', createdBy: teacher.id })

    const map = (await buildSemanticMap(student.id, id))!
    const [study] = map.nodes[0]!.exercises
    if (study?.kind !== 'translate') throw new Error('unreachable')
    // What the sentence said — not 움직임, 동작.
    expect(study.prompt).toBe('a change of position or place')
    expect(study.answer).toBe('위치나 장소의 변화')
    expect(study.answer).not.toBe(map.nodes[0]!.label)
    expect(study.heading).toBe('move')
  })

  it('sets the paper\'s own question in the test session', async () => {
    const { student, setId, ids } = await importRange()
    const queue = await buildScopedQueue(student.id, { scope: 'all', setId, wordLimit: 50 })
    const questions = await buildQuestions(student.id, queue)

    const definition = questions.filter((q) => q.kind === 'definition')
    expect(definition.length).toBeGreaterThan(0)

    const one = definition[0]!
    // English definition in, English word out — and the rivals are words from
    // this range, not from anywhere in the library. Which direction's card it
    // was scheduled against is not part of the question: this one is asked the
    // same way round in both.
    expect(one.answer).not.toMatch(/[가-힣]/)
    expect(one.options).toContain(one.answer)
    expect(one.options).toHaveLength(4)
    const inRange = new Set(ids.map((w) => w.lemma))
    for (const option of one.options) expect(inRange.has(option), option).toBe(true)
  })

  it('asks the map test from the map, in the direction it opens in', async () => {
    // The test opens on en_ko unless the reader says otherwise, and that
    // direction used to have one map variant — which needed two senses and a
    // sentence. A range of definitions has neither, so every word fell through
    // to the plain gloss question and the map test was the ordinary test.
    const { student, setId } = await importRange()
    const queue = await buildScopedQueue(student.id, {
      scope: 'all',
      setId,
      wordLimit: 50,
      directions: ['en_ko'],
    })
    const questions = await buildQuestions(student.id, queue)

    const fromTheMap = questions.filter((q) => q.kind !== 'gloss')
    expect(fromTheMap.length).toBeGreaterThan(0)
    expect(new Set(fromTheMap.map((q) => q.kind))).toContain('definition')

    const one = fromTheMap.find((q) => q.kind === 'definition')!
    // English definition in, the **word** out — the paper's own question, and
    // the one a student who never touches the direction toggle has to meet.
    // Asked the other way round it is the plain 영한 question with a longer
    // prompt: read the definition, then name the gloss printed beside that
    // word on every other screen.
    expect(one.prompt).toMatch(/^[a-z]/)
    expect(one.answer).toMatch(/^[a-zA-Z]/)
    expect(one.answer).not.toMatch(/[가-힣]/)
    expect(one.options).toHaveLength(4)
    for (const option of one.options) expect(option).not.toMatch(/[가-힣]/)
  })

  it('asks it the same way whichever direction the test opens in', async () => {
    const { student, setId } = await importRange()
    for (const direction of ['en_ko', 'ko_en'] as const) {
      const queue = await buildScopedQueue(student.id, {
        scope: 'all',
        setId,
        wordLimit: 50,
        directions: [direction],
      })
      const definitions = (await buildQuestions(student.id, queue)).filter(
        (q) => q.kind === 'definition',
      )
      expect(definitions.length, direction).toBeGreaterThan(0)
      for (const question of definitions) {
        expect(question.answer, direction).not.toMatch(/[가-힣]/)
      }
    }
  })

  it('tests the whole set, not the first pageful of it', async () => {
    // The range is fifty words. Revising fifty and being tested on the first
    // twenty-five in alphabetical order — with nothing on screen saying the
    // rest were not coming — is the same wall as the list's "다음".
    const { student, setId, ids } = await importRange()
    const queue = await buildScopedQueue(student.id, {
      scope: 'all',
      setId,
      directions: ['en_ko'],
    })
    expect(new Set(queue.map((item) => item.vocabularyId)).size).toBe(ids.length)

    const questions = await buildQuestions(student.id, queue)
    expect(new Set(questions.map((q) => q.vocabularyId)).size).toBe(ids.length)
  })
})
