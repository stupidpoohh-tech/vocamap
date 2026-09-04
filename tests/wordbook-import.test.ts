import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseWordbook } from '@/lib/import/wordbook'

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

  it('keeps the pronunciation, in brackets or slashes', () => {
    const { entries } = parseWordbook(SIMPLE)
    expect(entries[0]!.pronunciation).toBe('kəntémpərèri')
    expect(entries[1]!.pronunciation).toBe('ˈkændɪdeɪt')
  })

  it('leaves the pronunciation null when the book printed none', () => {
    expect(byLemma.get('govern')!.pronunciation).toBeNull()
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
