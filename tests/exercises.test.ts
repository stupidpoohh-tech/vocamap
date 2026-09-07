import { describe, expect, it } from 'vitest'
import {
  collocationExercises,
  confusableExercises,
  forMastery,
  meaningExercises,
  partnerWord,
  surfaceFormIn,
  wordFamilyExercises,
  type CollocationContent,
  type Exercise,
  type FamilyContent,
  type SentenceContent,
} from '@/lib/learning/exercises'
import { SEED_WORDS } from '@/lib/seed/words'

/**
 * The seed maps are the standard for approved content, so the questions are
 * checked against them rather than against invented material: a rule that only
 * holds for a fixture is not a rule.
 */
function seed(lemma: string) {
  const word = SEED_WORDS.find((w) => w.lemma === lemma)!
  const map = word.brainMap!
  return {
    lemma,
    map,
    sentences: map.sentences.map((s, i): SentenceContent => ({ ...s, id: `s${i}` })),
    collocations: map.collocations.map((c, i): CollocationContent => ({ ...c, id: `c${i}` })),
    family: map.wordFamily.map((f, i): FamilyContent => ({ ...f, id: `f${i}` })),
    pairs: map.similarWords.map((p, i) => ({
      pairId: `p${i}`,
      otherLemma: p.lemma,
      coreDifference: p.coreDifference,
      usageRule: p.usageRule,
      questions: p.questions.map((q, j) => ({ ...q, id: `p${i}q${j}` })),
    })),
  }
}

const answersOf = (exercises: Exercise[]) =>
  exercises.map((e) => (e.kind === 'choice' ? e.answer : e.answer))

describe('the answer is never what the card already shows', () => {
  // The workspace prints the node's label above the question and the map
  // prints it again behind. Every rule below exists because of that.

  it('does not ask a collocation for the expression written above it', () => {
    const { lemma, collocations } = seed('issue')
    for (const collocation of collocations) {
      const exercises = collocationExercises({ lemma, collocation, siblings: collocations })
      for (const answer of answersOf(exercises)) {
        expect(answer).not.toBe(collocation.expression)
      }
    }
  })

  it('does not ask a derived form for the form written above it', () => {
    const { family } = seed('maintain')
    for (const member of family) {
      const exercises = wordFamilyExercises({ member, family })
      for (const answer of answersOf(exercises)) {
        expect(answer).not.toBe(member.lemma)
      }
    }
  })

  it('does not ask a meaning node for the gloss written above it', () => {
    const { sentences } = seed('maintain')
    const exercises = meaningExercises({
      label: '(상태를) 유지하다',
      sense: '상태를 유지하다',
      sentences,
      meaningCoreKo: null,
    })
    for (const answer of answersOf(exercises)) {
      expect(answer).not.toBe('(상태를) 유지하다')
    }
  })

  it('blanks the half of the expression the page does not give away', () => {
    // "raise an issue" on the page of `issue`: the blank goes over `raise`.
    // Blanking the last word — what this used to do — blanked `issue` itself.
    const { lemma, collocations } = seed('issue')
    const raise = collocations.find((c) => c.expression.includes('raise'))!
    const [placement] = collocationExercises({ lemma, collocation: raise, siblings: collocations })

    expect(placement?.kind).toBe('choice')
    expect(placement && placement.kind === 'choice' && placement.answer).toContain('______')
    expect(placement && placement.kind === 'choice' && placement.answer).toContain('issue')
    expect(placement && placement.kind === 'choice' && placement.answer).not.toMatch(/raise/i)
  })
})

describe('partnerWord', () => {
  it('takes the half that is not the word being studied, wherever it sits', () => {
    expect(partnerWord('maintain order', 'maintain')).toBe('order')
    expect(partnerWord('raise an issue', 'issue')).toBe('raise')
    expect(partnerWord('maintain a relationship', 'maintain')).toBe('relationship')
  })

  it('skips articles, forms of be and bare prepositions', () => {
    expect(partnerWord('be deeply affected by', 'affect')).toBe('deeply')
    expect(partnerWord('directly affect', 'affect')).toBe('directly')
  })

  it('has nothing to blank when the expression is the word alone', () => {
    expect(partnerWord('the issue', 'issue')).toBeNull()
  })
})

describe('surfaceFormIn', () => {
  it('finds the word as the sentence inflected it', () => {
    expect(surfaceFormIn('The students raised an issue.', 'raise')).toBe('raised')
    expect(surfaceFormIn('The bridge is maintained twice a year.', 'maintain')).toBe('maintained')
    expect(surfaceFormIn('Regular maintenance is essential.', 'maintenance')).toBe('maintenance')
  })

  it('refuses a stem short enough to hit an unrelated word', () => {
    // "be" would otherwise match "because", "between", "before".
    expect(surfaceFormIn('This happened because of the rain.', 'be')).toBeNull()
  })

  it('reports the word is absent rather than guessing', () => {
    expect(surfaceFormIn('The weather can affect your sleep.', 'maintain')).toBeNull()
  })
})

describe('a confusable pair', () => {
  it('is asked as a comparison, not as a coin flip', () => {
    const { lemma, pairs } = seed('affect')
    const [first] = confusableExercises({ lemma, pair: pairs[0]! })

    expect(first?.kind).toBe('choice')
    if (first?.kind !== 'choice') throw new Error('unreachable')
    // Two contexts to judge between, not the two words with the answer above.
    expect(first.options).toHaveLength(2)
    for (const option of first.options) expect(option).toContain('___')
    expect(first.options).not.toContain(lemma)
  })

  it('does not ask again about the sentences the comparison has shown', () => {
    const { lemma, pairs } = seed('affect')
    const pair = pairs[0]!
    const exercises = confusableExercises({ lemma, pair })
    const [comparison, ...rest] = exercises

    if (comparison?.kind !== 'choice') throw new Error('unreachable')
    for (const exercise of rest) {
      if (exercise.kind !== 'choice') continue
      expect(comparison.options).not.toContain(exercise.prompt)
    }
    // The third curated question is still asked.
    expect(exercises).toHaveLength(2)
  })

  it('carries the usage rule the review screen used to keep to itself', () => {
    const { lemma, pairs } = seed('affect')
    const pair = pairs[0]!
    const [first] = confusableExercises({ lemma, pair })
    expect(first?.concept).toContain(pair.usageRule!)
  })

  it('still asks the curated blanks when only one side has a sentence', () => {
    const exercises = confusableExercises({
      lemma: 'maintain',
      pair: {
        pairId: 'p',
        otherLemma: 'keep',
        coreDifference: '차이',
        usageRule: null,
        questions: [
          { id: 'q1', prompt: 'Engineers ___ the bridge.', answer: 'maintain', explanation: '설명' },
        ],
      },
    })
    expect(exercises).toHaveLength(1)
    expect(exercises[0]!.kind === 'choice' && exercises[0]!.options).toEqual(
      expect.arrayContaining(['maintain', 'keep']),
    )
  })
})

describe('a meaning node', () => {
  it('asks which sentence carries the sense, with rival senses as the choices', () => {
    const { sentences } = seed('maintain')
    const [first] = meaningExercises({
      label: '(상태를) 유지하다',
      sense: '상태를 유지하다',
      sentences,
      meaningCoreKo: '핵심',
    })

    if (first?.kind !== 'choice') throw new Error('unreachable')
    expect(first.options.length).toBeGreaterThan(1)
    expect(first.answer).toBe('Regular exercise helps maintain good health.')
    // The rivals are sentences of other senses, not glosses.
    expect(first.options).toContain('He maintained that he had never seen the document.')
  })

  it('never translates a sentence whose translation it has just printed', () => {
    const { sentences } = seed('affect')
    const exercises = meaningExercises({
      label: '~에 영향을 미치다',
      sense: '영향을 미치다',
      sentences,
      meaningCoreKo: null,
    })

    const translate = exercises.find((e) => e.kind === 'translate')!
    const shown = exercises.filter((e) => e.kind === 'choice').flatMap((e) => e.options)
    expect(translate.prompt).not.toBe('')
    expect(shown).not.toContain(translate.prompt)
  })

  it('opens on the easiest sentence of the sense', () => {
    const of = (id: string, text: string, sense: string, difficulty: number): SentenceContent => ({
      id, text, ko: `${text} 번역`, targetMeaning: sense, highlight: null, difficulty,
    })
    const sentences = [
      of('a', 'Hard one.', '유지하다', 4),
      of('b', 'Easy one.', '유지하다', 1),
      of('c', 'Middle one.', '유지하다', 2),
      of('d', 'Other sense.', '주장하다', 1),
    ]
    const [first] = meaningExercises({
      label: '유지하다',
      sense: '유지하다',
      sentences,
      meaningCoreKo: null,
    })
    expect(first?.kind === 'choice' && first.answer).toBe('Easy one.')
  })

  it('translates the sentence when there is nothing to tell it apart from', () => {
    const sentences: SentenceContent[] = [
      { id: 'a', text: 'Only one.', ko: '하나뿐', targetMeaning: '뜻', highlight: null, difficulty: 1 },
    ]
    const exercises = meaningExercises({ label: '뜻', sense: '뜻', sentences, meaningCoreKo: null })
    expect(exercises).toHaveLength(1)
    expect(exercises[0]!.kind).toBe('translate')

    // And when the sense has one sentence but a rival to be told apart from,
    // that sentence is placed first and translated after — the placement says
    // which use it is, never what it means.
    const rival: SentenceContent = {
      id: 'b', text: 'Another sense.', ko: '다른 뜻', targetMeaning: '주장하다', highlight: null, difficulty: 1,
    }
    const both = meaningExercises({
      label: '유지하다',
      sense: '유지하다',
      sentences: [{ ...sentences[0]!, targetMeaning: '유지하다' }, rival],
      meaningCoreKo: null,
    })
    expect(both.map((e) => e.kind)).toEqual(['choice', 'translate'])
    expect(both[0]!.kind === 'choice' && both[0]!.explanation).not.toContain('하나뿐')
  })

  it('has nothing to ask about a sense with no sentence', () => {
    expect(
      meaningExercises({ label: '뜻', sense: '뜻', sentences: [], meaningCoreKo: null }),
    ).toEqual([])
  })
})

describe('material that arrived without a sentence', () => {
  // A wordbook prints a phrase and its meaning and no sentence at all. The
  // meaning is the one thing about the item the card does not already show.
  const bare = (over: Partial<CollocationContent> & { id: string }): CollocationContent => ({
    expression: '',
    ko: '',
    exampleSentence: null,
    ...over,
  })

  it('asks a phrase for its meaning, against the word its other phrases mean', () => {
    const siblings = [
      bare({ id: 'c0', expression: 'raise an issue', ko: '문제를 제기하다' }),
      bare({ id: 'c1', expression: 'address an issue', ko: '문제를 다루다' }),
    ]
    const [first] = collocationExercises({
      lemma: 'issue',
      collocation: siblings[0]!,
      siblings,
    })

    if (first?.kind !== 'choice') throw new Error('unreachable')
    expect(first.answer).toBe('문제를 제기하다')
    expect(first.options).toContain('문제를 다루다')
  })

  it('asks nothing rather than asking a question with one option', () => {
    const only = bare({ id: 'c0', expression: 'raise an issue', ko: '문제를 제기하다' })
    expect(collocationExercises({ lemma: 'issue', collocation: only, siblings: [only] })).toEqual([])
  })

  it('asks a derived form for its meaning the same way', () => {
    const family: FamilyContent[] = [
      { id: 'f0', lemma: 'maintenance', partOfSpeech: 'noun', ko: '유지, 정비', exampleSentence: null },
      { id: 'f1', lemma: 'maintainable', partOfSpeech: 'adjective', ko: '유지할 수 있는', exampleSentence: null },
    ]
    const [first] = wordFamilyExercises({ member: family[0]!, family })
    if (first?.kind !== 'choice') throw new Error('unreachable')
    expect(first.answer).toBe('유지, 정비')
    expect(first.options).toContain('유지할 수 있는')
  })
})

describe('a derived form with sentences', () => {
  it('is placed among its own family, every candidate blanked', () => {
    const { family } = seed('maintain')
    const [first] = wordFamilyExercises({ member: family[0]!, family })

    if (first?.kind !== 'choice') throw new Error('unreachable')
    expect(first.options).toHaveLength(2)
    for (const option of first.options) expect(option).toContain('______')
  })
})

describe('forMastery', () => {
  const place: Exercise = {
    kind: 'choice', prompt: 'p', options: ['a', 'b'], answer: 'a', explanation: 'e', level: 1,
  }
  const translate: Exercise = {
    kind: 'translate', prompt: 'p', highlight: null, answer: 'a', level: 2,
  }

  it('stops offering the way in to a student already past it', () => {
    expect(forMastery([place, translate])).toEqual([translate])
  })

  it('leaves a node that has nothing else alone', () => {
    expect(forMastery([place])).toEqual([place])
  })
})

describe('a word whose list gave a definition and nothing else', () => {
  // 어휘 / 영영 풀이 / 의미 and no sentence anywhere — the shape an exam range
  // arrives in. Before this the meaning node had nothing to ask at all.
  const args = {
    lemma: 'strength',
    label: '장점, 강점',
    sense: '장점, 강점',
    sentences: [] as SentenceContent[],
    meaningCoreKo: null,
    enDefinition: 'a quality or ability that gives you an advantage',
  }

  it('shows the definition and keeps the meaning back until it is asked for', () => {
    const [first] = meaningExercises(args)
    expect(first?.kind).toBe('translate')
    if (first?.kind !== 'translate') throw new Error('unreachable')
    expect(first.prompt).toBe(args.enDefinition)
    expect(first.answer).toBe('장점, 강점')
  })

  it('heads the card with the word, because the gloss is the answer', () => {
    const [first] = meaningExercises(args)
    if (first?.kind !== 'translate') throw new Error('unreachable')
    expect(first.heading).toBe('strength')
    expect(first.heading).not.toBe(args.label)
  })

  it('has nothing to show when the list printed no definition', () => {
    expect(meaningExercises({ ...args, enDefinition: null })).toEqual([])
  })

  it('comes before the sentence questions when the word has both', () => {
    const sentences: SentenceContent[] = [
      { id: 'a', text: 'Mine.', ko: '내 것', targetMeaning: '유지하다', highlight: null, difficulty: 1 },
      { id: 'b', text: 'Other.', ko: '다른 것', targetMeaning: '주장하다', highlight: null, difficulty: 1 },
    ]
    const exercises = meaningExercises({ ...args, label: '유지하다', sense: '유지하다', sentences })
    expect(exercises[0]!.kind === 'translate' && exercises[0]!.prompt).toBe(args.enDefinition)
    expect(exercises.length).toBeGreaterThan(1)
  })
})
