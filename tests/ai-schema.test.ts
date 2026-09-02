import { describe, expect, it } from 'vitest'
import {
  brainMapDraftSchema,
  draftQualityNotes,
  plannedNodeCount,
  validateDraftConsistency,
  type BrainMapDraft,
} from '@/lib/ai/schema'
import { BRAIN_MAP_SYSTEM, brainMapPrompt } from '@/lib/ai/prompts'
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

describe('the density rule', () => {
  const dense: BrainMapDraft = {
    ...minimal,
    meanings: [
      { ko: '문제, 쟁점', enDefinition: null, connectionNote: '', exampleChunk: null },
      { ko: '(잡지의) 호', enDefinition: null, connectionNote: '', exampleChunk: null },
    ],
    collocations: [
      { expression: 'raise an issue', ko: '문제를 제기하다', exampleSentence: null, importance: 1 },
      { expression: 'address an issue', ko: '문제를 다루다', exampleSentence: null, importance: 1 },
      { expression: 'take issue with', ko: '이의를 제기하다', exampleSentence: null, importance: 3 },
    ],
    similarWords: [
      { lemma: 'problem', coreDifference: '논의 대상인가, 해결할 골칫거리인가.', usageRule: null, questions: [] },
    ],
  }

  it('caps every list at what a map can actually carry', () => {
    // The rule is structural, not advisory: a model that ignores the prompt
    // still cannot fill the screen with true-but-unnecessary material.
    const over = (patch: Partial<BrainMapDraft>) =>
      brainMapDraftSchema.safeParse({ ...minimal, ...patch }).success
    const meaning = { ko: '뜻', enDefinition: null, connectionNote: '', exampleChunk: null }
    const collocation = { expression: 'x y', ko: '뜻', exampleSentence: null, importance: 2 }
    const pair = { lemma: 'other', coreDifference: '차이를 설명합니다.', usageRule: null, questions: [] }

    expect(over({ meanings: Array(3).fill(meaning) })).toBe(true)
    expect(over({ meanings: Array(4).fill(meaning) })).toBe(false)
    expect(over({ collocations: Array(3).fill(collocation) })).toBe(true)
    expect(over({ collocations: Array(4).fill(collocation) })).toBe(false)
    expect(over({ similarWords: [pair, pair] })).toBe(true)
    expect(over({ similarWords: [pair, pair, pair] })).toBe(false)
  })

  it('counts the nodes a draft would actually put on the map', () => {
    // issue: core meaning, one confusable, two collocations. The second sense
    // and the third collocation are real English and stay off the map.
    expect(plannedNodeCount(dense)).toBe(4)
    expect(plannedNodeCount(minimal)).toBe(1)
  })

  it('adds a further sense only when the map would otherwise be thin', () => {
    const thin: BrainMapDraft = { ...dense, similarWords: [], collocations: [] }
    expect(plannedNodeCount(thin)).toBe(2)
  })

  it('does not nag about material the map simply keeps in reserve', () => {
    // Three collocations where the map shows two is the rule working, not a
    // defect — the extras are still drill material and still reachable. The
    // section itself says so; a warning here would train the curator to ignore
    // the warnings that matter.
    expect(brainMapDraftSchema.safeParse(dense).success).toBe(true)
    expect(draftQualityNotes(dense)).toEqual([])
  })

  it('flags collocations that were all given the same importance', () => {
    // That is the model declining to say what matters, and it leaves the map
    // unable to size or place anything.
    const flat: BrainMapDraft = {
      ...minimal,
      collocations: [
        { expression: 'a b', ko: '가', exampleSentence: null, importance: 2 },
        { expression: 'c d', ko: '나', exampleSentence: null, importance: 2 },
        { expression: 'e f', ko: '다', exampleSentence: null, importance: 2 },
      ],
    }
    expect(draftQualityNotes(flat).some((n) => n.includes('중요도가 모두 같아요'))).toBe(true)
  })

  it('tells the model the budget and the priority order', () => {
    for (const phrase of ['3-5 nodes', 'PRIORITY ORDER', 'NEVER BECOMES A NODE']) {
      expect(BRAIN_MAP_SYSTEM).toContain(phrase)
    }
    expect(brainMapPrompt({ lemma: 'issue' })).toContain('count your nodes')
  })
})
