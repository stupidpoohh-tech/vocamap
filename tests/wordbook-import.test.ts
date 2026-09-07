import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseWordbook } from '@/lib/import/wordbook'
import { draftHasQuestions, toBrainMapDraft } from '@/lib/import/to-draft'
import { inBatches } from '@/lib/import/batches'

/**
 * A real test range, typed by the tutor who is going to use this — 20 words of
 * Word Master 고등 COMPLETE. If the format cannot take this without fighting,
 * it is the wrong format, so it is the fixture rather than something invented.
 */
const PAGE = readFileSync(new URL('./fixtures/wordbook-page.txt', import.meta.url), 'utf8')
const parsed = parseWordbook(PAGE)
const byLemma = new Map(parsed.entries.map((e) => [e.lemma, e]))

describe('a real test range', () => {
  it('reads every word without complaint', () => {
    expect(parsed.problems).toEqual([])
    expect(parsed.entries).toHaveLength(20)
  })

  it('takes the numbering off the headword', () => {
    expect(parsed.entries[0]!.lemma).toBe('govern')
    expect(parsed.entries[19]!.lemma).toBe('conversion')
  })

  it('keeps a blank line inside a word from splitting it', () => {
    // The tutor's own notes group synonyms, collocations and derived forms with
    // blank lines. Numbering is what separates words.
    const impulse = byLemma.get('impulse')!
    expect(impulse.senses).toHaveLength(1)
    expect(impulse.collocations).toHaveLength(2)
    expect(impulse.wordFamily).toHaveLength(1)
  })

  it('keeps a hyphenated headword whole', () => {
    expect(byLemma.get('hands-on')!.senses[0]!.ko).toBe('직접 해 보는, 실습의')
  })

  it('reads every part of speech as its own sense', () => {
    expect(byLemma.get('normal')!.senses.map((s) => [s.partOfSpeech, s.ko])).toEqual([
      ['adjective', '보통의, 평범한, 정상의'],
      ['noun', '보통, 평균, 정상'],
    ])
  })

  it('binds the example and its translation to the sense above them', () => {
    const govern = byLemma.get('govern')!
    expect(govern.senses[0]!.examples).toEqual([
      {
        en: 'Whatever we do on earth is governed by the rules of nature.',
        ko: '우리가 지구상에서 하는 모든 것은 자연의 법칙에 의해 지배를 받는다.',
      },
    ])
  })

  it('takes a word with no example at all', () => {
    // `magnetic` is printed with collocations only.
    const magnetic = byLemma.get('magnetic')!
    expect(magnetic.senses[0]!.examples).toEqual([])
    expect(magnetic.collocations).toHaveLength(5)
  })
})

/**
 * The `*` marker carries four different things, so what a line *is* has to be
 * read off its content. These are the cases that decide it.
 */
describe('sorting one marker into four things', () => {
  it('calls a phrase a collocation', () => {
    expect(byLemma.get('impulse')!.collocations).toEqual([
      { expression: 'impulse buying', ko: '충동 구매' },
      { expression: 'on impulse', ko: '충동적으로' },
    ])
    expect(byLemma.get('sue')!.collocations).toEqual([
      { expression: 'sue ~ for …', ko: '~에게 …에 관한 소송을 제기하다' },
    ])
    // Brackets inside the phrase are part of it, not a separator.
    expect(byLemma.get('compromise')!.collocations).toEqual([
      { expression: 'reach[come to] a compromise', ko: '타협에 이르다' },
    ])
  })

  it('calls a word built on the headword a derived form', () => {
    expect(byLemma.get('refrigeration')!.wordFamily).toEqual([
      { lemma: 'refrigerate', partOfSpeech: 'verb', ko: '냉장하다' },
      { lemma: 'refrigerator', partOfSpeech: 'noun', ko: '냉장고' },
    ])
    expect(byLemma.get('legislation')!.wordFamily.map((f) => f.lemma)).toEqual([
      'legislate',
      'legislative',
      'legislator',
    ])
  })

  it('calls an unrelated word a synonym', () => {
    expect(byLemma.get('govern')!.synonyms).toEqual([
      { lemma: 'rule', ko: '다스리다' },
      { lemma: 'command', ko: '지휘하다' },
    ])
    // Same meaning, no shared stem — the book teaches it beside the word, not
    // as part of it.
    expect(byLemma.get('refrigeration')!.synonyms).toEqual([
      { lemma: 'fridge', ko: '냉장고' },
    ])
  })

  it('leaves a contrast word on the synonym side, where the book puts it', () => {
    // `abnormal` and `inadequate` are built on their headwords, but what they
    // teach is a contrast. Requiring a shared opening rather than mere
    // containment keeps them out of the family.
    expect(byLemma.get('normal')!.synonyms.map((s) => s.lemma)).toContain('abnormal')
    expect(byLemma.get('adequate')!.synonyms.map((s) => s.lemma)).toContain('inadequate')
    expect(byLemma.get('plausible')!.synonyms.map((s) => s.lemma)).toContain('implausible')
    expect(byLemma.get('normal')!.wordFamily.map((f) => f.lemma)).toEqual(['normally'])
  })

  it('does not mistake a synonym written without a part of speech', () => {
    // `normal` lists `ordinary / 평범한` with no mark, next to nine collocations.
    const normal = byLemma.get('normal')!
    expect(normal.synonyms.map((s) => s.lemma)).toEqual(['ordinary', 'usual', 'abnormal'])
    expect(normal.collocations).toHaveLength(6)
    expect(normal.collocations[0]).toEqual({ expression: 'look normal', ko: '정상으로 보이다' })
  })

  it('keeps a parenthetical in the gloss rather than losing it', () => {
    expect(byLemma.get('scheme')!.synonyms[0]).toEqual({
      lemma: 'plan',
      ko: '계획 (= project)',
    })
  })
})

describe('the simpler blank-line format', () => {
  const SIMPLE = `contemporary [kəntémpərèri]
a. 현대의, 동시대의
- Most contemporary art began as some sort of craft.
= 대부분의 현대 예술은 일종의 공예로서 시작했다.
n. 동년배, 동시대인
+ contemporary art / 현대 미술
≒ modern / 현대의

candidate /ˈkændɪdeɪt/
n. 후보, 출마자; 지원자
- We decided to narrow down the candidates.
= 우리는 후보군을 좁히기로 했다.
* candidacy / n. 입후보`

  it('still works when there is no numbering', () => {
    const { entries, problems } = parseWordbook(SIMPLE)
    expect(problems).toEqual([])
    expect(entries.map((e) => e.lemma)).toEqual(['contemporary', 'candidate'])
  })

  it('takes the phonetics off the headword, in brackets or slashes', () => {
    // Nothing reads them any more, but they still have to come off: left on,
    // the lemma would be "contemporary [kəntémpərèri]" and the word would
    // never match anything already in the library.
    const { entries } = parseWordbook(SIMPLE)
    expect(entries.map((e) => e.lemma)).toEqual(['contemporary', 'candidate'])
    for (const entry of entries) expect(entry.lemma).not.toMatch(/[[\]/]/)
  })

  it('lets an explicit marker override what the content suggests', () => {
    // `modern` shares no stem with `contemporary`, so it would be a synonym
    // anyway — but `+` must make a single word a collocation regardless.
    const { entries } = parseWordbook('word\nn. 뜻\n+ single / 하나')
    expect(entries[0]!.collocations).toEqual([{ expression: 'single', ko: '하나' }])
    expect(entries[0]!.synonyms).toEqual([])
  })
})

describe('when a line cannot be read', () => {
  it('names the line', () => {
    const { problems } = parseWordbook('candidate\nn. 후보\n후보를 좁히다')
    expect(problems).toHaveLength(1)
    expect(problems[0]!.line).toBe(3)
    expect(problems[0]!.message).toContain('알 수 없는 줄')
  })

  it('refuses a block whose first line is not an English headword', () => {
    const { entries, problems } = parseWordbook('후보, 출마자\nn. 후보')
    expect(entries).toEqual([])
    expect(problems[0]!.message).toContain('영어 표제어')
  })

  it('refuses a word with no sense at all', () => {
    const { entries, problems } = parseWordbook('candidate\n* presidential candidate / 대통령 후보')
    expect(entries).toEqual([])
    expect(problems[0]!.message).toContain('뜻이 없습니다')
  })

  it('says so when a translation has no example above it', () => {
    const { problems } = parseWordbook('candidate\nn. 후보\n= 해석만 있습니다')
    expect(problems[0]!.message).toContain('예문이 없습니다')
  })

  it('ignores comments and extra blank lines', () => {
    const { entries, problems } = parseWordbook(
      '# 16과 시험범위\n\n\ncandidate\nn. 후보\n\n\n\nethics\nn. 윤리학\n',
    )
    expect(problems).toEqual([])
    expect(entries.map((e) => e.lemma)).toEqual(['candidate', 'ethics'])
  })
})

/**
 * What a wordbook page does that the first twenty words did not.
 *
 * Found by running likely shapes through the parser rather than by waiting for
 * a set of forty to come back wrong — a line that silently becomes the wrong
 * kind of thing is worse than one that fails, because nothing says so.
 */
describe('the shapes a page throws at it', () => {
  const parse = (text: string) => parseWordbook(text)

  it('reads the relation marks a book uses beside ≒', () => {
    for (const marker of ['↔', 'cf.', 'syn.', 'ant.']) {
      const { entries, problems } = parse(`normal\na. 정상의\n${marker} abnormal / 비정상적인`)
      expect(problems, marker).toEqual([])
      expect(entries[0]!.synonyms, marker).toEqual([{ lemma: 'abnormal', ko: '비정상적인' }])
    }
  })

  it('does not mistake a slash inside a sentence for a gloss separator', () => {
    // "He works the 9/5 shift." was being filed as a collocation, and its
    // translation then had no example to attach to.
    const { entries, problems } = parse(
      'shift\nn. 교대\n* He works the 9/5 shift.\n= 그는 9시부터 5시까지 교대 근무를 한다.',
    )
    expect(problems).toEqual([])
    expect(entries[0]!.collocations).toEqual([])
    expect(entries[0]!.senses[0]!.examples[0]).toEqual({
      en: 'He works the 9/5 shift.',
      ko: '그는 9시부터 5시까지 교대 근무를 한다.',
    })
  })

  it('keeps a slash inside a Korean gloss', () => {
    const { entries } = parse('either\na. 둘 중 하나의\n* either A or B / A 또는 B 둘 중 하나')
    expect(entries[0]!.collocations).toEqual([
      { expression: 'either A or B', ko: 'A 또는 B 둘 중 하나' },
    ])
  })

  it('takes a gloss written with no part-of-speech mark', () => {
    const { entries, problems } = parse('albeit\n비록 ~일지라도')
    expect(problems).toEqual([])
    expect(entries[0]!.senses).toEqual([
      {
        partOfSpeech: null,
        ko: '비록 ~일지라도',
        enDefinition: null,
        enDefinitionKo: null,
        examples: [],
      },
    ])
  })

  it('still refuses a stray Korean line once the gloss is in', () => {
    // Guessing there would bury a line that simply lost its marker.
    const { problems } = parse('candidate\nn. 후보\n후보를 좁히다')
    expect(problems).toHaveLength(1)
  })

  it('takes a headword of more than one word', () => {
    const { entries, problems } = parse(
      'narrow down\nv. 좁히다\n* We narrowed down the list.\n= 우리는 목록을 좁혔다.',
    )
    expect(problems).toEqual([])
    expect(entries[0]!.lemma).toBe('narrow down')
  })

  it('takes more than one example under one sense', () => {
    const { entries } = parse(
      'run\nv. 달리다\n* He runs fast.\n= 그는 빠르게 달린다.\n* She runs daily.\n= 그녀는 매일 달린다.',
    )
    expect(entries[0]!.senses[0]!.examples).toHaveLength(2)
  })
})

/**
 * The other shape a range arrives in: a table of 어휘 / 영영 풀이 / 의미, pasted
 * out of a document. Real, and 50 words of it, because the rows that make the
 * format hard are the ones a made-up sample would not have thought of — a
 * phrase for a headword, a missing part-of-speech mark, a definition that
 * starts with the word "a", and two page breaks in the middle.
 */
const TABLE = readFileSync(new URL('./fixtures/wordbook-table.txt', import.meta.url), 'utf8')
const table = parseWordbook(TABLE)
const tableByLemma = new Map(table.entries.map((e) => [e.lemma, e]))

describe('a range typed as a table', () => {
  it('reads every row without complaint', () => {
    expect(table.problems).toEqual([])
    expect(table.entries).toHaveLength(50)
  })

  it('steps over the header, the rule under it, and the page breaks', () => {
    // The paste carries "| | 어휘 | 영영 풀이 | 의미 |" twice, a |---|---| under
    // each, and " * 1 -" / "image.png" where the pages ended.
    expect(table.entries.map((e) => e.lemma)).not.toContain('어휘')
    expect(table.entries.map((e) => e.lemma)).not.toContain('image.png')
  })

  it('tells the word from its definition by which is shorter', () => {
    // Neither column is named and their order is not promised, so the two are
    // told apart by what they are: a word, and a sentence about that word.
    const sign = tableByLemma.get('sign up')!.senses[0]!
    expect(sign.ko).toBe('신청하다')
    expect(sign.enDefinition).toBe('to agree to take part in an organized activity')
  })

  it('takes a headword of several words', () => {
    for (const lemma of ['sign up', 'in front of', 'put together', 'according to']) {
      expect(tableByLemma.has(lemma), lemma).toBe(true)
    }
  })

  it('reads the part-of-speech mark the book prints, and does without one', () => {
    expect(tableByLemma.get('strength')!.senses[0]!.partOfSpeech).toBe('noun')
    expect(tableByLemma.get('toward')!.senses[0]!.partOfSpeech).toBe('preposition')
    expect(tableByLemma.get('still')!.senses[0]!.partOfSpeech).toBe('adverb')
    // The book marks none of the phrases, and inventing one would be worse.
    expect(tableByLemma.get('according to')!.senses[0]!.partOfSpeech).toBeNull()
  })

  it('does not eat the "a" of a definition that begins with one', () => {
    // `a` is a part-of-speech mark in this table's own vocabulary, so without
    // requiring the dot an English mark carries, "a large number or amount of
    // people or things" arrives as 형용사 plus "large number or amount...".
    const lots = tableByLemma.get('lots of')!.senses[0]!
    expect(lots.partOfSpeech).toBeNull()
    expect(lots.enDefinition).toBe('a large number or amount of people or things')
  })

  it('reads the same table pasted out of a spreadsheet', () => {
    const tabbed = '어휘\t영영 풀이\t의미\nstrength\t명 a quality that helps you\t장점'
    const { entries, problems } = parseWordbook(tabbed)
    expect(problems).toEqual([])
    expect(entries[0]!.lemma).toBe('strength')
    expect(entries[0]!.senses[0]!.enDefinition).toBe('a quality that helps you')
  })

  it('leaves a line-format paste alone', () => {
    // One stray pipe is not a reason to abandon the format the rest is in.
    const { entries } = parseWordbook('govern\nv. 통치하다 | 다스리다')
    expect(entries[0]!.lemma).toBe('govern')
    expect(entries[0]!.senses[0]!.enDefinition).toBeNull()
  })
})

describe('what the teacher is told before saving', () => {
  // The counts under each word are the only place a mis-read paste shows
  // itself, so what they claim has to be true.

  it('counts a definition as material, not as a missing example', () => {
    // Every word in a table of definitions has no sentence. Judging by
    // sentences alone flagged all fifty as unusable on the way in — while the
    // map was in fact about to ask every one of them.
    for (const entry of table.entries) {
      const draft = toBrainMapDraft(entry)
      expect(draft.sentences, entry.lemma).toHaveLength(0)
      expect(draftHasQuestions(draft, { rivalDefinitions: true }), entry.lemma).toBe(true)
    }
  })

  it('says so when a word really has nothing to ask', () => {
    // One word, one gloss, no definition, no sentence, nothing beside it.
    const { entries } = parseWordbook('albeit\n비록 ~일지라도')
    const draft = toBrainMapDraft(entries[0]!)
    expect(draftHasQuestions(draft, { rivalDefinitions: false })).toBe(false)
  })

  it('does not count a definition that has nothing to be told apart from', () => {
    const { entries } = parseWordbook('어휘\t영영 풀이\t의미\nstrength\ta quality that helps\t장점')
    const draft = toBrainMapDraft(entries[0]!)
    expect(draftHasQuestions(draft, { rivalDefinitions: false })).toBe(false)
    expect(draftHasQuestions(draft, { rivalDefinitions: true })).toBe(true)
  })
})

describe('writing a whole range', () => {
  // Not a unit of behaviour but a unit of cost: the batching only matters
  // because the alternative was a wait the teacher read as a failure.

  it('keeps the words in the order they were typed', async () => {
    // The batches finish out of order; the set must not.
    const order: number[] = []
    const done: number[] = []
    const result = await inBatches([0, 1, 2, 3, 4, 5, 6, 7, 8], 4, async (n) => {
      order.push(n)
      await new Promise((resolve) => setTimeout(resolve, (9 - n) % 5))
      done.push(n)
      return n * 10
    })
    expect(result).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80])
    // And they really did overlap, or the test proves nothing.
    expect(done).not.toEqual(order)
  })

  it('never has more than the batch width in flight', async () => {
    let inFlight = 0
    let peak = 0
    await inBatches([...Array(20).keys()], 6, async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
    })
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak).toBeGreaterThan(1)
  })
})

describe('a table that also carries the definition\'s translation', () => {
  // 어휘 / 영영 풀이 / 영영 풀이 해석 / 의미. Two of those columns are Korean,
  // and nothing in the text of either says which is which — so this is the one
  // shape that cannot be read by content and needs the header.
  const FOUR = [
    '|  | 어휘 | 영영 풀이 | 영영 풀이 해석 | 의미 |',
    '|---|---|---|---|---|',
    '| 1 | strength | 명 a quality or ability that gives you an advantage | 유리함을 주는 자질이나 능력 | 장점, 강점 |',
    '| 2 | sign up | to agree to take part in an organized activity | 조직된 활동에 참여하기로 동의하다 | 신청하다 |',
  ].join('\n')

  const four = parseWordbook(FOUR)

  it('keeps the two Korean columns apart', () => {
    expect(four.problems).toEqual([])
    const sense = four.entries[0]!.senses[0]!
    expect(sense.ko).toBe('장점, 강점')
    expect(sense.enDefinitionKo).toBe('유리함을 주는 자질이나 능력')
    // The gloss must not have swallowed the translation, which is what
    // happens when both Korean cells are read as more meaning.
    expect(sense.ko).not.toContain('자질')
  })

  it('still reads the definition and the part-of-speech mark off the column', () => {
    const sense = four.entries[0]!.senses[0]!
    expect(sense.partOfSpeech).toBe('noun')
    expect(sense.enDefinition).toBe('a quality or ability that gives you an advantage')
  })

  it('reads a phrase with no mark the same way', () => {
    const sense = four.entries[1]!.senses[0]!
    expect(sense.partOfSpeech).toBeNull()
    expect(sense.enDefinition).toBe('to agree to take part in an organized activity')
    expect(sense.enDefinitionKo).toBe('조직된 활동에 참여하기로 동의하다')
  })

  it('leaves a three-column table exactly as it was', () => {
    // The header now decides the columns where there is one, and this must not
    // change what the range that has no 해석 column already produced.
    const sense = tableByLemma.get('strength')!.senses[0]!
    expect(sense.ko).toBe('장점, 강점')
    expect(sense.enDefinition).toBe('a quality or ability that gives you an advantage')
    expect(sense.enDefinitionKo).toBeNull()
    expect(table.entries).toHaveLength(50)
  })

  it('carries the translation into the draft', () => {
    expect(toBrainMapDraft(four.entries[0]!).meanings[0]!.enDefinitionKo).toBe(
      '유리함을 주는 자질이나 능력',
    )
  })
})
