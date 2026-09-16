import { beforeEach, describe, expect, it } from 'vitest'
import {
  cleanReading,
  definitionReadingBatchSchema,
  definitionReadingPrompt,
} from '@/lib/ai/definition-reading'
import { countMissingReadings, fillDefinitionReadings } from '@/lib/data/definition-reading'
import { writeDraft, getMasterBrainMap } from '@/lib/data/brain-map'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { parseWordbook } from '@/lib/import/wordbook'
import { toBrainMapDraft } from '@/lib/import/to-draft'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

describe('reading a translation back', () => {
  // The one failure that matters and the one a length check cannot see: the
  // model answering with the headword's gloss. "점" is a perfectly good Korean
  // word and a perfectly useless answer to "a small round mark", because it is
  // already printed on the map beside the question.
  it('refuses the word\'s gloss in place of the definition', () => {
    expect(cleanReading('점', '점')).toBeNull()
    expect(cleanReading('장점, 강점', '장점, 강점')).toBeNull()
    // Spacing and separators are not what makes it the same answer.
    expect(cleanReading('장점,강점', '장점, 강점')).toBeNull()
  })

  it('keeps a real translation of the definition', () => {
    expect(cleanReading('작고 둥근 표시', '점')).toBe('작고 둥근 표시')
    expect(cleanReading('유리함을 주는 자질이나 능력', '장점, 강점')).toBe(
      '유리함을 주는 자질이나 능력',
    )
  })

  it('refuses a definition that came back barely translated', () => {
    expect(cleanReading('a small round mark', '점')).toBeNull()
    expect(cleanReading('a small round mark 라는 뜻', '점')).toBeNull()
  })

  it('strips the quotation marks a model adds anyway', () => {
    expect(cleanReading('"작고 둥근 표시"', '점')).toBe('작고 둥근 표시')
    expect(cleanReading('  작고 둥근 표시  ', null)).toBe('작고 둥근 표시')
  })

  it('refuses nothing at all', () => {
    expect(cleanReading('', '점')).toBeNull()
    expect(cleanReading('   ', '점')).toBeNull()
  })
})

describe('what the model is asked', () => {
  it('numbers the entries so a reply can be matched to them', () => {
    const prompt = definitionReadingPrompt([
      { id: 'a', lemma: 'dot', definition: 'a small round mark' },
      { id: 'b', lemma: 'goal', definition: 'something that you hope to achieve' },
    ])
    expect(prompt).toContain('1. (dot) a small round mark')
    expect(prompt).toContain('2. (goal) something that you hope to achieve')
  })

  it('takes a reply that carries the numbers back', () => {
    const parsed = definitionReadingBatchSchema.parse({
      entries: [{ number: 2, ko: '이루기를 바라는 어떤 것' }],
    })
    expect(parsed.entries[0]!.number).toBe(2)
  })
})

const TABLE = [
  '| 어휘 | 영영 풀이 | 의미 |',
  '|---|---|---|',
  '| dot | 명 a small round mark | 점 |',
  '| goal | 명 something that you hope to achieve | 목표 |',
].join('\n')

describe.skipIf(!hasDatabase)('filling in the readings', () => {
  beforeEach(async () => {
    await resetDatabase()
    process.env.LLM_PROVIDER = 'mock'
  })

  async function importTable(text = TABLE) {
    const teacher = await createUser('teacher')
    const ids: Array<{ lemma: string; id: string }> = []
    for (const entry of parseWordbook(text).entries) {
      const draft = toBrainMapDraft(entry)
      const { id } = await findOrCreateVocabulary({
        lemma: entry.lemma,
        translations: draft.primaryTranslations,
        createdBy: teacher.id,
      })
      await writeDraft(id, draft, { status: 'approved', createdBy: teacher.id })
      ids.push({ lemma: entry.lemma, id })
    }
    return ids
  }

  it('counts the definitions that have no reading yet', async () => {
    const ids = await importTable()
    expect(await countMissingReadings()).toBe(ids.length)
  })

  it('writes a reading onto each definition and stops counting it', async () => {
    const ids = await importTable()
    const result = await fillDefinitionReadings()

    expect(result.attempted).toBe(2)
    expect(result.filled).toBe(2)
    expect(result.remaining).toBe(0)

    const map = (await getMasterBrainMap(ids[0]!.id))!
    expect(map.meanings[0]!.enDefinitionKo).toBeTruthy()
    // The reading, not the gloss — which is the whole reason it exists.
    expect(map.meanings[0]!.enDefinitionKo).not.toBe(map.meanings[0]!.ko)
  })

  it('never overwrites one the teacher typed in', async () => {
    // A table with the 해석 column already filled.
    await importTable(
      [
        '| 어휘 | 영영 풀이 | 영영 풀이 해석 | 의미 |',
        '|---|---|---|---|',
        '| dot | 명 a small round mark | 작고 둥근 표시 | 점 |',
      ].join('\n'),
    )
    expect(await countMissingReadings()).toBe(0)

    const result = await fillDefinitionReadings()
    expect(result.attempted).toBe(0)
    expect(result.filled).toBe(0)
  })

  it('has nothing to do when every definition is read', async () => {
    await importTable()
    await fillDefinitionReadings()
    const again = await fillDefinitionReadings()
    expect(again).toEqual({ attempted: 0, filled: 0, remaining: 0 })
  })
})
