import { describe, expect, it } from 'vitest'
import {
  brainMapDraftSchema,
  draftQualityNotes,
  validateDraftConsistency,
  type BrainMapDraft,
} from '@/lib/ai/schema'
import { MockProvider, setLLMProvider, getLLMProvider, LLMError } from '@/lib/ai/provider'
import { SEED_WORDS } from '@/lib/seed/words'

const minimal: BrainMapDraft = {
  meaningCoreKo: '어떤 상태가 계속 이어지도록 하다.',
  meaningCoreEn: null,
  primaryTranslations: ['유지하다'],
  meanings: [],
  sentences: [],
  collocations: [],
  wordFamily: [],
  similarWords: [],
}

describe('brain map draft schema', () => {
  it('accepts a draft where every optional node is empty', () => {
    // Empty is a correct answer: the model must never be forced to pad.
    expect(brainMapDraftSchema.safeParse(minimal).success).toBe(true)
  })

  it('rejects a draft with no meaning core', () => {
    expect(brainMapDraftSchema.safeParse({ ...minimal, meaningCoreKo: '' }).success).toBe(false)
  })

  it('rejects a draft with no translation', () => {
    expect(brainMapDraftSchema.safeParse({ ...minimal, primaryTranslations: [] }).success).toBe(false)
  })

  it('caps list lengths so a map stays selective', () => {
    const tooMany = {
      ...minimal,
      collocations: Array.from({ length: 6 }, (_, i) => ({
        expression: `expr ${i}`,
        ko: '뜻',
        exampleSentence: null,
        importance: 1,
      })),
    }
    expect(brainMapDraftSchema.safeParse(tooMany).success).toBe(false)
  })

  it('strips unknown keys rather than silently storing them', () => {
    const result = brainMapDraftSchema.safeParse({ ...minimal, hallucinatedField: 'nope' })
    expect(result.success).toBe(true)
    expect(result.success && 'hallucinatedField' in result.data).toBe(false)
  })
})

describe('cross-field consistency checks', () => {
  it('rejects a highlight that does not appear in its sentence', () => {
    const problems = validateDraftConsistency({
      ...minimal,
      sentences: [
        {
          text: 'Regular exercise helps maintain good health.',
          ko: '규칙적인 운동은 건강 유지에 도움이 된다.',
          targetMeaning: '유지하다',
          highlight: 'preserve good health',
          difficulty: 1,
        },
      ],
    })
    expect(problems.join(' ')).toContain('highlight')
  })

  it('allows several sentences to share a usage', () => {
    // A word with two senses and six sentences should repeat: three examples
    // of each is good material. Demanding a unique usage per sentence rejected
    // exactly that, and threw away a generation that had already been paid for.
    const sentence = (targetMeaning: string, text: string) => ({
      text,
      ko: '한국어 번역',
      targetMeaning,
      highlight: 'attribute',
      difficulty: 2,
    })
    const draft = {
      ...minimal,
      sentences: [
        sentence('원인을 ~라고 여기다', 'They attribute the delay to bad weather.'),
        sentence('원인을 ~라고 여기다', 'Critics attribute the win to luck.'),
        sentence('원인을 ~라고 여기다', 'She attributes her health to swimming.'),
        sentence('고유한 특성', 'Patience is his best attribute.'),
        sentence('고유한 특성', 'Speed is an attribute of the new engine.'),
        sentence('작품을 ~의 것으로 보다', 'The play is attributed to an unknown writer.'),
      ],
    }
    expect(validateDraftConsistency(draft)).toEqual([])
    expect(draftQualityNotes(draft)).toEqual([])
  })

  it('warns, without rejecting, when every sentence shows one usage', () => {
    const same = {
      text: 'They maintain high standards.',
      ko: '그들은 높은 기준을 유지한다.',
      targetMeaning: '유지하다',
      highlight: 'maintain high standards',
      difficulty: 1,
    }
    const draft = { ...minimal, sentences: [same, same, same] }
    expect(validateDraftConsistency(draft)).toEqual([])
    expect(draftQualityNotes(draft).join(' ')).toContain('모두 같은 용법')
  })

  it('warns when one usage crowds out the others', () => {
    const make = (targetMeaning: string) => ({
      text: 'They maintain high standards.',
      ko: '한국어 번역',
      targetMeaning,
      highlight: 'maintain',
      difficulty: 1,
    })
    const draft = {
      ...minimal,
      sentences: [make('a'), make('a'), make('a'), make('a'), make('b')],
    }
    expect(validateDraftConsistency(draft)).toEqual([])
    expect(draftQualityNotes(draft).join(' ')).toContain('몰려 있습니다')
  })

  it('rejects a battle question without exactly one blank', () => {
    const problems = validateDraftConsistency({
      ...minimal,
      similarWords: [
        {
          lemma: 'keep',
          coreDifference: '노력의 유무가 다르다.',
          usageRule: null,
          questions: [
            { prompt: 'Please ___ the door ___ open.', answer: 'keep', explanation: '설명' },
          ],
        },
      ],
    })
    expect(problems.join(' ')).toContain('exactly one blank')
  })

  it('passes every hand-authored seed brain map', () => {
    for (const word of SEED_WORDS) {
      if (!word.brainMap) continue
      const parsed = brainMapDraftSchema.parse(word.brainMap)
      expect(validateDraftConsistency(parsed), `seed word "${word.lemma}"`).toEqual([])
      expect(draftQualityNotes(parsed), `seed word "${word.lemma}"`).toEqual([])
    }
  })
})

describe('provider abstraction', () => {
  it('validates provider output against the schema before returning it', async () => {
    const mock = new MockProvider()
    mock.register('maintain', { meaningCoreKo: '너무 짧음' })
    setLLMProvider(mock)
    try {
      await expect(
        getLLMProvider().generateStructured({
          system: 's',
          prompt: 'Target word: maintain',
          schema: brainMapDraftSchema,
          schemaName: 'brain_map',
        }),
      ).rejects.toBeInstanceOf(LLMError)
    } finally {
      setLLMProvider(null)
    }
  })

  it('returns parsed data for a valid response', async () => {
    const mock = new MockProvider()
    mock.register('maintain', minimal)
    setLLMProvider(mock)
    try {
      const result = await getLLMProvider().generateStructured({
        system: 's',
        prompt: 'Target word: maintain',
        schema: brainMapDraftSchema,
        schemaName: 'brain_map',
      })
      expect(result.data.meaningCoreKo).toBe(minimal.meaningCoreKo)
      expect(result.provider).toBe('mock')
    } finally {
      setLLMProvider(null)
    }
  })
})
