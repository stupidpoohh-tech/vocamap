import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseWordbook } from '@/lib/import/wordbook'
import { findForm, toBrainMapDraft } from '@/lib/import/to-draft'
import { writeDraft } from '@/lib/data/brain-map'
import { buildSemanticMap } from '@/lib/data/semantic-map'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import type { Exercise } from '@/lib/data/semantic-map'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

/** Narrows to the multiple-choice shape, failing loudly if it is not one. */
function asChoice(exercise: Exercise | undefined): Extract<Exercise, { kind: 'choice' }> {
  expect(exercise?.kind).toBe('choice')
  return exercise as Extract<Exercise, { kind: 'choice' }>
}

const PAGE = readFileSync(new URL('./fixtures/wordbook-page.txt', import.meta.url), 'utf8')
const entries = parseWordbook(PAGE).entries
const byLemma = new Map(entries.map((e) => [e.lemma, e]))
const draftOf = (lemma: string) => toBrainMapDraft(byLemma.get(lemma)!)

describe('a wordbook entry as a draft', () => {
  it('keeps every sense, in book order', () => {
    expect(draftOf('normal').meanings.map((m) => m.ko)).toEqual([
      '보통의, 평범한, 정상의',
      '보통, 평균, 정상',
    ])
  })

  it('remembers which sense each sentence was written under', () => {
    const draft = draftOf('govern')
    expect(draft.sentences).toHaveLength(1)
    expect(draft.sentences[0]!.targetMeaning).toBe('통치하다, 다스리다; 지배하다')
  })

  it('marks the word as the sentence actually spells it', () => {
    // The highlight has to be a substring of the sentence verbatim.
    expect(draftOf('govern').sentences[0]!.highlight).toBe('governed')
    expect(draftOf('aspire').sentences[0]!.highlight).toBe('aspires')
    expect(draftOf('celebrity').sentences[0]!.highlight).toBe('celebrities')
    expect(draftOf('monetary').sentences[0]!.highlight).toBe('Monetary')
  })

  it('never puts a highlight the sentence does not contain', () => {
    for (const entry of entries) {
      for (const sentence of toBrainMapDraft(entry).sentences) {
        if (!sentence.highlight) continue
        expect(sentence.text, `${entry.lemma}`).toContain(sentence.highlight)
      }
    }
  })

  it('does not match a word inside a longer one', () => {
    expect(findForm('That is not an issue for us.', 'sue')).toBeNull()
  })

  it('puts the first two collocations on the map and the rest behind it', () => {
    const normal = draftOf('normal')
    expect(normal.collocations).toHaveLength(6)
    expect(normal.collocations.map((c) => c.importance)).toEqual([1, 1, 2, 2, 2, 2])
  })

  it('leaves what the book did not print empty', () => {
    const draft = draftOf('impulse')
    // No sentences per collocation, no English definitions, no invented core.
    expect(draft.collocations.every((c) => c.exampleSentence === null)).toBe(true)
    expect(draft.meanings.every((m) => m.enDefinition === null)).toBe(true)
    expect(draft.meaningCoreEn).toBeNull()
    // And no confusable pairs: the book lists synonyms without differences.
    expect(draft.similarWords).toEqual([])
  })

  it('takes a word the book printed with no example at all', () => {
    const magnetic = draftOf('magnetic')
    expect(magnetic.sentences).toEqual([])
    expect(magnetic.collocations).toHaveLength(5)
  })
})

describe.skipIf(!hasDatabase)('the map a wordbook entry produces', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function mapFor(lemma: string) {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const entry = byLemma.get(lemma)!
    const { id } = await findOrCreateVocabulary({
      lemma: entry.lemma,
      pronunciation: entry.pronunciation,
      createdBy: teacher.id,
    })
    await writeDraft(id, toBrainMapDraft(entry), { status: 'approved', createdBy: teacher.id })
    const map = await buildSemanticMap(student.id, id)
    return map!
  }

  it('asks which sense a sentence shows when the word has two', async () => {
    const map = await mapFor('normal')
    const core = map.nodes.find((n) => n.kind === 'coreMeaning')!
    expect(core.exercises).toHaveLength(1)
    expect(asChoice(core.exercises[0]).options).toEqual(
      expect.arrayContaining(['보통의, 평범한, 정상의', '보통, 평균, 정상']),
    )
  })

  it('asks for a translation when the word has only one sense', async () => {
    const map = await mapFor('govern')
    const core = map.nodes.find((n) => n.kind === 'coreMeaning')!
    expect(core.exercises[0]!.kind).toBe('translate')
  })

  it('gives every collocation a question, though the book printed no sentences', async () => {
    // This is the gap the import would otherwise fall into: a wordbook lists
    // phrases with glosses and nothing else, and the cloze question needs a
    // sentence. The meaning question needs only what the book prints.
    const map = await mapFor('normal')
    const collocations = map.nodes.filter((n) => n.kind === 'collocation')
    expect(collocations).toHaveLength(6)
    for (const node of collocations) {
      expect(node.exercises, node.label).toHaveLength(1)
      expect(asChoice(node.exercises[0]).answer).toBe(node.label)
    }
  })

  it('gives every derived form a question too', async () => {
    const map = await mapFor('legislation')
    const family = map.nodes.filter((n) => n.kind === 'wordFamily')
    expect(family.map((n) => n.label)).toEqual(['legislate', 'legislative', 'legislator'])
    for (const node of family) {
      expect(node.exercises, node.label).toHaveLength(1)
      // Told apart from its own family, not from unrelated words.
      expect(asChoice(node.exercises[0]).options).toContain('legislation')
    }
  })

  it('does not ask about a lone collocation with nothing to contrast it with', async () => {
    // `sue` has exactly one. A question whose only option is the answer teaches
    // nothing, so there is none.
    const map = await mapFor('sue')
    const collocation = map.nodes.find((n) => n.kind === 'collocation')!
    expect(collocation.exercises).toEqual([])
  })

  it('builds a usable map for a word with no example sentence', async () => {
    const map = await mapFor('magnetic')
    const answerable = map.nodes.filter((n) => n.exercises.length)
    // Five collocations and two derived forms, all askable from glosses alone.
    expect(answerable).toHaveLength(7)
  })
})
